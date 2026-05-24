#!/usr/bin/env node
// scripts/agent-review.mjs
//
// Reads all defect-run-* artifacts the workflow downloaded into a single
// bundle directory, extracts the failed test cases from every JUnit XML
// and the k6 summary, hands the context to GitHub Models (free LLM
// inference via GITHUB_TOKEN with `models: read`), and emits
// agent-feedback.md alongside the artifacts.
//
// Inputs (env):
//   GITHUB_TOKEN       provides auth to the GitHub Models endpoint
//   DEFECTS_INPUT      CSV of defect ids active for this run
//   BUNDLE_DIR         path to artifact-download root (default _bundle)
//   AGENT_MODEL        override model slug (default openai/gpt-4o-mini)
//   AGENT_DRY_RUN      when "true", skip the network call and write a
//                      stub feedback file (useful for local testing)
//
// Output:
//   <BUNDLE_DIR>/agent-feedback.md
//   <BUNDLE_DIR>/agent-summary.json  (machine-readable)
//
// The script is intentionally network-tolerant: if GitHub Models is
// unavailable or returns an error, it still emits a useful markdown
// summary built from the JUnit data alone, prefixed with a notice.

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

const BUNDLE_DIR = process.env.BUNDLE_DIR || "_bundle";
const MODEL = process.env.AGENT_MODEL || "openai/gpt-4o-mini";
const ENDPOINT = "https://models.github.ai/inference/chat/completions";
const DRY_RUN = process.env.AGENT_DRY_RUN === "true";
const DEFECT_IDS = (process.env.DEFECTS_INPUT || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEFECT_HINTS = {
  login_accepts_any_pin:
    "Auth layer skipped the constant-time PIN comparison; any 6-digit PIN is accepted. Unit test_auth and Playwright login spec are the canaries.",
  negative_qty_allowed:
    "POST /api/items bypasses the ItemCreate Pydantic body model, so quantities below zero land in the store. Backend integration parametrized 'negative_quantity' case + Schemathesis discover this from the OpenAPI Ge(0) constraint.",
  off_by_one_pagination:
    "GET /api/items drops the last row of each page. Backend integration tests asserting full item counts fail; Playwright row counts fail.",
  delete_skips_auth:
    "DELETE /api/items/{id}'s bearer dependency is conditionally bypassed, leaving only DELETE unauthenticated. The parametrized 'test_missing_bearer_returns_401[delete_item]' case is the smoking gun.",
  slow_query:
    "time.sleep(0.4) at the top of list_items breaks the k6 p95<200ms SLO. summary.thresholds_passed flips to false.",
};

// --- artifact discovery ---------------------------------------------------

async function findJunitFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".xml")) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found;
}

async function readK6Summary(root) {
  // perf artifact uploads summary.json at the bundle subdir root.
  const candidate = join(root, "defect-run-perf", "summary.json");
  if (!existsSync(candidate)) return null;
  try {
    const raw = await readFile(candidate, "utf8");
    return { path: candidate, summary: JSON.parse(raw) };
  } catch (err) {
    return { path: candidate, error: err.message };
  }
}

// --- JUnit parsing --------------------------------------------------------
//
// Deliberately string-based rather than pulling in xml2js / fast-xml-parser
// to keep the workflow free of extra installs. JUnit XML produced by pytest,
// vitest, playwright and mocha-junit-reporter all use the same minimal
// shape we care about.

function parseJunit(xml) {
  const cases = [];
  // matches <testcase ... />  OR  <testcase ...>(body)</testcase>
  // Non-greedy attrs so self-closing variants don't swallow the trailing
  // slash before the alternation gets to try `\/>`.
  const caseRe = /<testcase\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1]);
    const inner = m[2] ?? "";
    const failure = matchTag(inner, "failure") || matchTag(inner, "error");
    const skipped = inner.includes("<skipped");
    cases.push({
      classname: attrs.classname ?? "",
      name: attrs.name ?? "",
      time: Number.parseFloat(attrs.time ?? "0") || 0,
      status: failure ? "failed" : skipped ? "skipped" : "passed",
      failure,
    });
  }
  return cases;
}

function parseAttrs(blob) {
  const out = {};
  const re = /(\w[\w:-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(blob)) !== null) {
    out[m[1]] = decodeXmlEntities(m[2]);
  }
  return out;
}

function matchTag(xml, name) {
  const opener = new RegExp(
    `<${name}\\b([^>]*)(?:/\\s*>|>([\\s\\S]*?)</${name}>)`,
    "i",
  );
  const m = opener.exec(xml);
  if (!m) return null;
  const attrs = parseAttrs(m[1]);
  const body = (m[2] ?? "").trim();
  return {
    message: attrs.message ?? "",
    type: attrs.type ?? "",
    body: decodeXmlEntities(stripCdata(body)),
  };
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// --- LLM call -------------------------------------------------------------

function buildPrompt({ defects, failures, perf, totals }) {
  const failureBlobs = failures.slice(0, 12).map((f, i) => {
    const body = (f.failure?.body || f.failure?.message || "").slice(0, 1200);
    return `### Failure ${i + 1}
- suite: ${f.suite}
- test: ${f.classname}.${f.name}
- message: ${f.failure?.message || "(no message)"}
- excerpt:
\`\`\`
${body}
\`\`\``;
  });

  const perfBlock = perf?.summary
    ? `\n\nk6 summary:
\`\`\`json
${JSON.stringify(
  {
    thresholds_passed: perf.summary.thresholds_passed,
    request_count: perf.summary.request_count,
    failed_rate: perf.summary.failed_rate,
    p95_ms: perf.summary.p95_ms,
    p99_ms: perf.summary.p99_ms,
  },
  null,
  2,
)}
\`\`\``
    : "";

  const hints = defects
    .map((id) => `- **${id}**: ${DEFECT_HINTS[id] || "(no hint)"}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "You are a senior QA engineer reviewing a CI run that intentionally",
        "injected one or more known defects into the qa-automation-lab demo",
        "app. Your job is to explain *why* the failing tests fired in terms",
        "of the active defects. Be concise (under 400 words total). Use",
        "headings: 'Summary', 'Per-failure analysis', 'Suggested fix'.",
        "Refer to defects by their id. Do not invent fixes for defects",
        "that are not in the active list.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Active defects:\n${hints}\n\nTotals: ${totals.failed} failed, ${totals.passed} passed, ${totals.skipped} skipped across ${totals.suiteCount} suites.${perfBlock}\n\n${failureBlobs.join("\n\n")}`,
    },
  ];
}

async function callGithubModels(messages) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 700,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub Models ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// --- main -----------------------------------------------------------------

function fallbackBody(failures, totals) {
  const lines = ["_Agent unavailable; rendering rule-based summary._\n"];
  lines.push(
    `**Active defects:** ${DEFECT_IDS.join(", ") || "(none declared)"}`,
  );
  lines.push(
    `\n**Totals:** ${totals.failed} failed · ${totals.passed} passed · ${totals.skipped} skipped across ${totals.suiteCount} suites.\n`,
  );
  if (failures.length === 0) {
    lines.push("No failures recorded.");
    return lines.join("\n");
  }
  lines.push("\n### Failures\n");
  for (const f of failures.slice(0, 12)) {
    lines.push(`- \`${f.suite}\` → ${f.classname}.${f.name}`);
    if (f.failure?.message) {
      lines.push(`  - ${f.failure.message.split("\n")[0]}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const bundleStats = existsSync(BUNDLE_DIR) ? await stat(BUNDLE_DIR) : null;
  if (!bundleStats?.isDirectory()) {
    console.error(`Bundle dir not found: ${BUNDLE_DIR}`);
    process.exit(1);
  }

  const junitFiles = await findJunitFiles(BUNDLE_DIR);
  const perf = await readK6Summary(BUNDLE_DIR);
  const failures = [];
  const totals = { failed: 0, passed: 0, skipped: 0, suiteCount: 0 };

  for (const file of junitFiles) {
    const xml = await readFile(file, "utf8");
    const cases = parseJunit(xml);
    if (cases.length === 0) continue;
    totals.suiteCount += 1;
    const suite = basename(file).replace(/\.xml$/, "");
    // Better suite name: parent dir under _bundle gives the artifact label
    // (e.g. defect-run-backend, defect-run-playwright). Strip the prefix.
    const parts = file.split("/");
    const artifactDir = parts.find((p) => p.startsWith("defect-run-"));
    const suiteLabel = artifactDir
      ? artifactDir.replace(/^defect-run-/, "")
      : suite;
    for (const c of cases) {
      totals[c.status] = (totals[c.status] || 0) + 1;
      if (c.status === "failed") {
        failures.push({ ...c, suite: suiteLabel, junit: file });
      }
    }
  }

  // k6 doesn't emit JUnit; if thresholds failed, synthesize a failure
  // so the agent (and the dashboard) see the perf tier as red.
  if (perf?.summary && perf.summary.thresholds_passed === false) {
    failures.push({
      suite: "perf",
      classname: "k6",
      name: "items_smoke (p95/p99 SLO)",
      status: "failed",
      failure: {
        message: `k6 thresholds failed: p95=${perf.summary.p95_ms}ms p99=${perf.summary.p99_ms}ms (limits 200/400)`,
        body: JSON.stringify(perf.summary, null, 2),
      },
    });
    totals.failed += 1;
  }

  let agentBody;
  let modelUsed = MODEL;
  let agentStatus = "ok";

  if (DRY_RUN) {
    agentBody = fallbackBody(failures, totals);
    agentStatus = "dry-run";
  } else if (failures.length === 0) {
    agentBody = `_No failures detected in this run, even with defects ${DEFECT_IDS.join(", ")} active. That itself may be a finding — the active defects may not have a test that fires for them yet._`;
    agentStatus = "no-failures";
  } else {
    try {
      const messages = buildPrompt({
        defects: DEFECT_IDS,
        failures,
        perf,
        totals,
      });
      agentBody = await callGithubModels(messages);
    } catch (err) {
      console.error(`GitHub Models call failed: ${err.message}`);
      agentBody = fallbackBody(failures, totals);
      agentStatus = `fallback:${err.message}`;
    }
  }

  const header = [
    "# Agent failure review",
    "",
    `- **Active defects:** ${DEFECT_IDS.join(", ") || "(none)"}`,
    `- **Totals:** ${totals.failed} failed · ${totals.passed} passed · ${totals.skipped} skipped (${totals.suiteCount} suites)`,
    `- **Model:** ${modelUsed} (${agentStatus})`,
    "",
    "---",
    "",
  ].join("\n");

  const feedbackPath = join(BUNDLE_DIR, "agent-feedback.md");
  await writeFile(feedbackPath, header + agentBody + "\n");

  // Machine-readable summary the dashboard can consume directly.
  const summary = {
    defects: DEFECT_IDS,
    totals,
    failures: failures.map((f) => ({
      suite: f.suite,
      classname: f.classname,
      name: f.name,
      message: f.failure?.message || "",
    })),
    perf_thresholds_passed: perf?.summary?.thresholds_passed ?? null,
    perf_summary: perf?.summary ?? null,
    agent_status: agentStatus,
    model: modelUsed,
  };
  await writeFile(
    join(BUNDLE_DIR, "agent-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );

  console.log(`Wrote ${feedbackPath} (${agentStatus})`);
}

await main();
