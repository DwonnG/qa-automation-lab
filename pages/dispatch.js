// qa-automation-lab dashboard — defect-injection panel controller.
//
// Reads the worker endpoint from <meta name="defect-dispatch-url">; if
// empty, the panel renders read-only (the build step disables the
// checkboxes and the "Run" button). When live, clicking the button POSTs
// the selected defect ids to the worker, which proxies a workflow_dispatch
// on dispatch-defect-run.yml using a fine-scoped PAT. The worker returns
// a run id; we poll /run/<id> until the workflow completes, then fetch
// the agent-feedback.md + agent-summary.json from the worker (which
// commits the bundle to gh-pages /defect-runs/<id>/).
//
// "Example run" links short-circuit the polling loop and just render
// pre-seeded /defect-runs/example-<id>/ artifacts, so the panel is
// useful even before the worker is configured.

(function () {
  "use strict";

  var docMeta = function (name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  };

  var DISPATCH_URL = docMeta("defect-dispatch-url");
  var RUNS_BASE = docMeta("defect-runs-base") || "./defect-runs/";

  var panel = document.querySelector(".defect-panel");
  if (!panel) return;
  var statusEl = panel.querySelector("[data-defect-status]");
  var resultEl = panel.querySelector("[data-defect-result]");
  var runBtn = panel.querySelector(".defect-run-btn");
  var live = panel.getAttribute("data-live") === "true";

  // ---------- helpers ------------------------------------------------------

  function setStatus(msg, klass) {
    statusEl.textContent = msg || "";
    statusEl.className =
      "defect-panel-status" + (klass ? " defect-panel-status--" + klass : "");
  }

  function selectedDefects() {
    var boxes = panel.querySelectorAll(
      'input[type="checkbox"][name="defect"]:checked',
    );
    return Array.prototype.map.call(boxes, function (b) {
      return b.value;
    });
  }

  function affectedTiers() {
    // Mirrors the workflow's defect-to-tier map; used to flip the right
    // pyramid bands red while a run is in flight.
    var rows = panel.querySelectorAll(
      '.defect-row input[type="checkbox"]:checked',
    );
    var tiers = {};
    Array.prototype.forEach.call(rows, function (input) {
      var row = input.closest(".defect-row");
      if (!row) return;
      var tier = row.getAttribute("data-tier");
      if (tier) tiers[tier] = true;
    });
    return Object.keys(tiers);
  }

  function markTiersPending(tiers) {
    document.querySelectorAll(".lab-tier").forEach(function (el) {
      el.classList.remove("lab-tier--defect-pending");
    });
    tiers.forEach(function (tier) {
      var bands = document.querySelectorAll(".lab-tier--" + tier);
      bands.forEach(function (el) {
        el.classList.add("lab-tier--defect-pending");
      });
    });
  }

  function clearTierMarks() {
    document.querySelectorAll(".lab-tier").forEach(function (el) {
      el.classList.remove("lab-tier--defect-pending");
      el.classList.remove("lab-tier--defect-failed");
    });
  }

  function markTiersFailed(tiers) {
    tiers.forEach(function (tier) {
      var bands = document.querySelectorAll(".lab-tier--" + tier);
      bands.forEach(function (el) {
        el.classList.remove("lab-tier--defect-pending");
        el.classList.add("lab-tier--defect-failed");
      });
    });
  }

  // Minimal markdown → HTML for headings, lists, fenced code, inline
  // backticks, and bold. Pulling in marked.js would be more correct but
  // adds 30KB of script for a single pane on a static page; the agent's
  // output is constrained by the prompt to those primitives.
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
    // List blocks
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

  // ---------- example-run handler -----------------------------------------
  // The "example run" links on each defect row should not navigate away;
  // instead they fetch the pre-seeded agent-feedback.md inline.

  panel.addEventListener("click", function (e) {
    var link = e.target.closest("[data-defect-example]");
    if (!link) return;
    e.preventDefault();
    var id = link.getAttribute("data-defect-example");
    var base = RUNS_BASE + "example-" + id + "/";
    setStatus("Loading example run for " + id + "…", "info");
    fetch(base + "agent-feedback.md", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (md) {
        clearTierMarks();
        var row = link.closest(".defect-row");
        var tier = row ? row.getAttribute("data-tier") : null;
        if (tier) markTiersFailed([tier]);
        showResult(
          '<header class="defect-result-head">' +
            '<span class="defect-result-tag">Example run · ' +
            id +
            "</span>" +
            "</header>" +
            '<div class="defect-result-body">' +
            renderMarkdown(md) +
            "</div>",
        );
        setStatus("Showing pre-seeded example run.", "ok");
      })
      .catch(function (err) {
        setStatus(
          "No example available yet for " +
            id +
            " (" +
            err.message +
            "). Pre-seed under docs/defects/example-runs/.",
          "err",
        );
      });
  });

  // ---------- live dispatch (only when DISPATCH_URL is configured) --------

  if (!live || !DISPATCH_URL) {
    // Still allow example-run clicks above; no live dispatch wiring.
    return;
  }

  runBtn.addEventListener("click", function () {
    var defects = selectedDefects();
    if (defects.length === 0) {
      setStatus("Pick at least one defect first.", "err");
      return;
    }
    runBtn.disabled = true;
    resultEl.hidden = true;
    var tiers = affectedTiers();
    markTiersPending(tiers);
    setStatus("Dispatching workflow…", "info");

    fetch(DISPATCH_URL + "/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defects: defects.join(","),
        requestor: "dashboard",
      }),
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
        pollRun(runId, tiers);
      })
      .catch(function (err) {
        runBtn.disabled = false;
        clearTierMarks();
        setStatus("Dispatch failed: " + err.message, "err");
      });
  });

  function pollRun(runId, tiers) {
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
              clearTierMarks();
              runBtn.disabled = false;
              setStatus("Timed out waiting for run #" + runId + ".", "err");
            }
            return;
          }
          // Completed — fetch the bundle's agent-feedback.md and summary.
          renderRunResult(runId, tiers, data);
        })
        .catch(function (err) {
          clearTierMarks();
          runBtn.disabled = false;
          setStatus("Poll failed: " + err.message, "err");
        });
    };
    poll();
  }

  function renderRunResult(runId, tiers, data) {
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
        runBtn.disabled = false;
        clearTierMarks();
        if (summary && summary.totals && summary.totals.failed > 0) {
          markTiersFailed(tiers);
        }
        setStatus(
          "Run #" +
            runId +
            " complete. Conclusion: " +
            (data.conclusion || "unknown") +
            ".",
          summary && summary.totals && summary.totals.failed > 0 ? "err" : "ok",
        );
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
            "</header>" +
            '<div class="defect-result-body">' +
            renderMarkdown(md) +
            "</div>",
        );
      })
      .catch(function (err) {
        runBtn.disabled = false;
        setStatus("Loaded run but failed to render: " + err.message, "err");
      });
  }
})();
