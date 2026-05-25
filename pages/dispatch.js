// Defect-injection controller.
//
// Pyramid + injector live side by side. Selecting a defect from the
// dropdown immediately pulses the affected tier band above and reveals
// a detail card with Example/Run-live actions. "Example output" loads
// the pre-seeded markdown from /defect-runs/example-<id>/ (always
// available). "Run live" requires <meta name="defect-dispatch-url">
// and POSTs to the Cloudflare Worker for a real workflow_dispatch.

(function () {
  "use strict";

  var docMeta = function (name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  };

  var DISPATCH_URL = docMeta("defect-dispatch-url");
  var RUNS_BASE = docMeta("defect-runs-base") || "./defect-runs/";

  var panel = document.querySelector(".defect-injector");
  if (!panel) return;

  var pillGroup = panel.querySelector("[data-defect-pills]");
  var actionsEl = panel.querySelector("[data-defect-actions]");
  var statusEl = panel.querySelector("[data-defect-status]");
  var resultEl = panel.querySelector("[data-defect-result]");
  var live = panel.getAttribute("data-live") === "true";
  var selectedId = "";

  var catalogNode = panel.querySelector("[data-defect-catalog]");
  var catalog = {};
  try {
    catalog = JSON.parse(catalogNode.textContent || "{}");
  } catch (_) {
    catalog = {};
  }

  // ---------- helpers ------------------------------------------------------

  function setStatus(msg, klass) {
    statusEl.textContent = msg || "";
    statusEl.className =
      "defect-injector-status" +
      (klass ? " defect-injector-status--" + klass : "");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function clearTierMarks() {
    document.querySelectorAll(".lab-tier").forEach(function (el) {
      el.classList.remove("lab-tier--defect-pending");
      el.classList.remove("lab-tier--defect-failed");
    });
  }

  function markTierPending(tierKey) {
    clearTierMarks();
    if (!tierKey) return;
    document.querySelectorAll(".lab-tier--" + tierKey).forEach(function (el) {
      el.classList.add("lab-tier--defect-pending");
    });
  }

  function markTierFailed(tierKey) {
    if (!tierKey) return;
    document.querySelectorAll(".lab-tier--" + tierKey).forEach(function (el) {
      el.classList.remove("lab-tier--defect-pending");
      el.classList.add("lab-tier--defect-failed");
    });
  }

  // Minimal markdown → HTML. Agent prompt restricts output to headings,
  // lists, fenced/inline code, and bold — a 30KB marked.js dep isn't
  // worth the bytes for that surface.
  function renderMarkdown(md) {
    if (!md) return "";
    var safe = String(md)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    safe = safe.replace(/```([\s\S]*?)```/g, function (_, code) {
      return "<pre><code>" + code.replace(/\n$/, "") + "</code></pre>";
    });
    safe = safe.replace(/`([^`\n]+)`/g, function (_, code) {
      return "<code>" + code + "</code>";
    });
    safe = safe.replace(/^### (.*)$/gm, "<h4>$1</h4>");
    safe = safe.replace(/^## (.*)$/gm, "<h3>$1</h3>");
    safe = safe.replace(/^# (.*)$/gm, "<h2>$1</h2>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    var lines = safe.split("\n");
    var out = [];
    var inList = false;
    lines.forEach(function (line) {
      var m = line.match(/^[-*]\s+(.*)$/);
      if (m) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push("<li>" + m[1] + "</li>");
      } else {
        if (inList) {
          out.push("</ul>");
          inList = false;
        }
        if (line.trim() === "") out.push("");
        else out.push("<p>" + line + "</p>");
      }
    });
    if (inList) out.push("</ul>");
    return out.join("\n");
  }

  function showResult(html) {
    resultEl.innerHTML = html;
    resultEl.hidden = false;
  }

  function dismissResult() {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
  }

  function resultCloseButton() {
    return (
      '<button type="button" class="defect-result-close" ' +
      'data-defect-result-close aria-label="Close result panel" ' +
      'title="Close (Esc)">×</button>'
    );
  }

  resultEl.addEventListener("click", function (e) {
    if (e.target.closest("[data-defect-result-close]")) {
      e.preventDefault();
      dismissResult();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !resultEl.hidden) {
      dismissResult();
    }
  });

  // ---------- action-bar rendering ----------------------------------------
  // The card itself shows title + tags, so the action bar below only
  // needs the contextual CTAs: Example output, Run live, and spec link.

  function renderActions(id) {
    var d = catalog[id];
    if (!d) {
      actionsEl.hidden = true;
      actionsEl.innerHTML = "";
      return;
    }
    var runBtn = live
      ? '<button type="button" class="btn btn--primary defect-injector-run" data-defect-run="' +
        escapeHtml(id) +
        '">Run live &#9654;</button>'
      : '<button type="button" class="btn btn--primary" disabled title="Live runs are disabled in this deploy (DEFECT_DISPATCH_URL not configured)">Run live &#9654;</button>';

    actionsEl.innerHTML =
      '<a class="btn btn--ghost defect-injector-example" href="' +
      escapeHtml(d.exampleUrl) +
      '" data-defect-example="' +
      escapeHtml(id) +
      '" title="Show the pre-seeded AI failure review (no CI run triggered)">Show example output</a>' +
      runBtn +
      '<a class="defect-injector-spec" href="' +
      escapeHtml(d.specUrl) +
      '" target="_blank" rel="noopener noreferrer">spec&nbsp;&#8599;</a>';
    actionsEl.hidden = false;
  }

  // ---------- card group change handler -----------------------------------
  //
  // Single-select radio group: clicking a card selects it, clicking the
  // active card again deselects (so the user can clear without a separate
  // button). Mouse + keyboard both go through the same path because the
  // cards are real <button> elements.

  function setSelected(id) {
    selectedId = id || "";
    var cards = pillGroup.querySelectorAll("[data-defect-pill]");
    cards.forEach(function (c) {
      var active = c.getAttribute("data-defect-pill") === selectedId;
      c.setAttribute("aria-checked", active ? "true" : "false");
      c.classList.toggle("defect-card--selected", active);
    });

    dismissResult();
    setStatus("");

    if (!selectedId) {
      clearTierMarks();
      actionsEl.hidden = true;
      actionsEl.innerHTML = "";
      return;
    }
    var d = catalog[selectedId];
    if (d && d.tier) markTierPending(d.tier);
    renderActions(selectedId);
  }

  pillGroup.addEventListener("click", function (e) {
    var card = e.target.closest("[data-defect-pill]");
    if (!card || !pillGroup.contains(card)) return;
    var id = card.getAttribute("data-defect-pill");
    setSelected(id === selectedId ? "" : id);
  });

  // ---------- example-output handler --------------------------------------

  panel.addEventListener("click", function (e) {
    var link = e.target.closest("[data-defect-example]");
    if (!link) return;
    e.preventDefault();
    var id = link.getAttribute("data-defect-example");
    var d = catalog[id];
    var label = (d && d.title) || id;
    var base = RUNS_BASE + "example-" + id + "/";
    setStatus("Loading example output for " + label + "…", "info");
    fetch(base + "agent-feedback.md", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (md) {
        if (d && d.tier) markTierFailed(d.tier);
        var title = (d && d.title) || id;
        showResult(
          '<header class="defect-result-head">' +
            '<span class="defect-result-tag">Example output · ' +
            escapeHtml(title) +
            "</span>" +
            '<span class="defect-result-spacer"></span>' +
            resultCloseButton() +
            "</header>" +
            '<div class="defect-result-body">' +
            renderMarkdown(md) +
            "</div>",
        );
        setStatus("Showing pre-seeded example output.", "ok");
      })
      .catch(function (err) {
        setStatus(
          "No example available yet for " +
            label +
            " (" +
            err.message +
            "). Pre-seed under docs/defects/example-runs/.",
          "err",
        );
      });
  });

  // ---------- live dispatch (only when DISPATCH_URL is configured) --------

  if (!live || !DISPATCH_URL) return;

  panel.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-defect-run]");
    if (!btn) return;
    var id = btn.getAttribute("data-defect-run");
    var d = catalog[id];
    var label = (d && d.title) || id;
    btn.disabled = true;
    dismissResult();
    if (d && d.tier) markTierPending(d.tier);
    setStatus("Dispatching workflow for " + label + "…", "info");

    fetch(DISPATCH_URL + "/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defects: id, requestor: "dashboard" }),
    })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error("dispatch " + r.status + ": " + t.slice(0, 200));
          });
        }
        return r.json();
      })
      .then(function (data) {
        var runId = data.run_id;
        if (!runId) throw new Error("worker did not return a run_id");
        setStatus("Run #" + runId + " queued. Polling…", "info");
        pollRun(runId, id, btn);
      })
      .catch(function (err) {
        btn.disabled = false;
        clearTierMarks();
        setStatus("Dispatch failed: " + err.message, "err");
      });
  });

  function pollRun(runId, defectId, btn) {
    var attempts = 0;
    var maxAttempts = 120; // 10 minutes at 5s
    var poll = function () {
      attempts += 1;
      fetch(DISPATCH_URL + "/run/" + runId, { cache: "no-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("status " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (data.status !== "completed") {
            setStatus(
              "Run #" +
                runId +
                " " +
                (data.status || "running") +
                "… (" +
                attempts +
                "/" +
                maxAttempts +
                ")",
              "info",
            );
            if (attempts < maxAttempts) {
              setTimeout(poll, 5000);
            } else {
              btn.disabled = false;
              clearTierMarks();
              setStatus("Timed out waiting for run #" + runId + ".", "err");
            }
            return;
          }
          renderRunResult(runId, defectId, btn, data);
        })
        .catch(function (err) {
          btn.disabled = false;
          clearTierMarks();
          setStatus("Poll failed: " + err.message, "err");
        });
    };
    poll();
  }

  function renderRunResult(runId, defectId, btn, data) {
    var base = (data.bundle_url || RUNS_BASE + runId + "/").replace(
      /\/?$/,
      "/",
    );
    Promise.all([
      fetch(base + "agent-feedback.md").then(function (r) {
        return r.ok ? r.text() : "";
      }),
      fetch(base + "agent-summary.json").then(function (r) {
        return r.ok ? r.json() : null;
      }),
    ])
      .then(function (parts) {
        var md = parts[0] || "";
        var summary = parts[1];
        btn.disabled = false;
        var d = catalog[defectId];
        var failed =
          summary && summary.totals ? summary.totals.failed || 0 : null;
        var agentStatus = summary && summary.agent_status;

        // Drive both the tier color AND the status pill from the same
        // source: the per-test failure count from agent-summary.json.
        // "Conclusion: success" on the GitHub run is misleading here
        // because suite jobs run with continue-on-error so the agent can
        // still review — only the agent job decides workflow conclusion.
        var msg;
        var klass;
        if (failed === null) {
          // No summary returned (worker hiccup) — fall back to run conclusion.
          msg =
            "Run #" +
            runId +
            " complete. Conclusion: " +
            (data.conclusion || "unknown") +
            ".";
          klass = data.conclusion === "success" ? "ok" : "err";
          clearTierMarks();
        } else if (agentStatus && agentStatus !== "ok") {
          msg =
            "Run #" +
            runId +
            " · agent error (" +
            agentStatus +
            "). No review available.";
          klass = "err";
          clearTierMarks();
        } else if (failed > 0) {
          // The expected happy path for the demo: the pyramid caught it.
          // The workflow itself will be conclusion=failure too (suite jobs
          // no longer swallow test failures), which is the honest signal.
          msg =
            "Run #" +
            runId +
            " · " +
            failed +
            " failure" +
            (failed === 1 ? "" : "s") +
            " caught.";
          klass = "err";
          if (d && d.tier) markTierFailed(d.tier);
        } else if (data.conclusion && data.conclusion !== "success") {
          // Tests passed (failed=0) but the workflow itself failed →
          // setup/env error (e.g. backend didn't start), not a coverage
          // gap. Don't claim "escaped" — that would be misleading.
          msg =
            "Run #" +
            runId +
            " · workflow failed (" +
            data.conclusion +
            ") before tests could verdict the defect.";
          klass = "err";
          clearTierMarks();
        } else {
          // Tests ran clean AND the workflow passed → real coverage gap.
          // The defect made it through every suite that opted in to it.
          msg = "Run #" + runId + " · defect escaped — no tests caught it.";
          klass = "warn";
          clearTierMarks();
        }
        setStatus(msg, klass);

        showResult(
          '<header class="defect-result-head">' +
            '<span class="defect-result-tag">Run #' +
            runId +
            "</span>" +
            (data.run_url
              ? ' <a href="' +
                data.run_url +
                '" target="_blank" rel="noopener">view in Actions ↗</a>'
              : "") +
            '<span class="defect-result-spacer"></span>' +
            resultCloseButton() +
            "</header>" +
            '<div class="defect-result-body">' +
            renderMarkdown(md) +
            "</div>",
        );
      })
      .catch(function (err) {
        btn.disabled = false;
        setStatus("Loaded run but failed to render: " + err.message, "err");
      });
  }
})();
