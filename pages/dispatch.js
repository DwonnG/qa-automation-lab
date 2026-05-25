// Defect-injection panel controller.
//
// Reads <meta name="defect-dispatch-url"> — empty = read-only mode.
// When live: POST /dispatch to the worker, poll /run/<id> until done,
// then fetch the agent bundle. "Example run" links short-circuit to
// pre-seeded /defect-runs/example-<id>/ artifacts so the panel is
// useful even without a worker.

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
  var runBtnDefaultLabel =
    runBtn.getAttribute("data-default-label") || runBtn.textContent.trim();

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

  // Toggles the run button between idle (ghost, no count) and armed
  // (primary, "Run with N defect(s)"). Hooked to the panel's change event.
  function syncRunButton() {
    if (!live) return;
    var count = selectedDefects().length;
    if (count === 0) {
      runBtn.disabled = true;
      runBtn.textContent = runBtnDefaultLabel;
      runBtn.classList.remove("btn--primary");
      runBtn.classList.add("btn--ghost");
    } else {
      runBtn.disabled = false;
      runBtn.textContent =
        "Run with " + count + " defect" + (count === 1 ? "" : "s");
      runBtn.classList.remove("btn--ghost");
      runBtn.classList.add("btn--primary");
    }
  }

  function affectedTiers() {
    // Mirrors the workflow's defect-to-tier map.
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

  // Minimal markdown → HTML. The agent prompt restricts output to
  // headings, lists, fenced code, inline backticks, and bold, so a 30KB
  // marked.js dep isn't worth the bytes.
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

  // ---------- example-run handler -----------------------------------------

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

  if (!live || !DISPATCH_URL) return;

  panel.addEventListener("change", function (e) {
    if (e.target && e.target.matches('input[type="checkbox"][name="defect"]')) {
      syncRunButton();
    }
  });
  syncRunButton();

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
        syncRunButton();
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
              syncRunButton();
              setStatus("Timed out waiting for run #" + runId + ".", "err");
            }
            return;
          }
          renderRunResult(runId, tiers, data);
        })
        .catch(function (err) {
          clearTierMarks();
          syncRunButton();
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
        syncRunButton();
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
        syncRunButton();
        setStatus("Loaded run but failed to render: " + err.message, "err");
      });
  }
})();
