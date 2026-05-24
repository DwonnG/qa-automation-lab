#!/usr/bin/env node
// Build the GitHub Pages dashboard for qa-automation-lab.
//
// Reads downloaded CI artifacts from --artifacts-dir, parses JUnit XML and the
// k6 summary JSON, and emits:
//   <out>/index.html                 Top-level dashboard
//   <out>/demo/...                   The live React demo (already built)
//   <out>/reports/<suite>/index.html Per-suite detail page
//   <out>/data/dashboard.json        Machine-readable snapshot
//   <out>/styles.css, <out>/404.html Copied from pages/
//
// Zero npm dependencies: pure Node 22 + a small regex-based JUnit parser. The
// JUnit subset we emit is stable (pytest, vitest, mocha-junit-reporter,
// Playwright) and the parser is permissive about extra attributes.
//
// Usage:
//   node scripts/build-pages-dashboard.mjs \
//     --artifacts-dir _artifacts \
//     --web-dist web/dist \
//     --pages-dir pages \
//     --out _site

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { cp, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { argv, env } from "node:process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI / config
// ---------------------------------------------------------------------------

const args = parseArgs(argv.slice(2));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = resolve(args["artifacts-dir"] ?? join(ROOT, "_artifacts"));
const WEB_DIST = resolve(args["web-dist"] ?? join(ROOT, "web/dist"));
const PAGES_DIR = resolve(args["pages-dir"] ?? join(ROOT, "pages"));
const DEFECTS_DIR = resolve(args["defects-dir"] ?? join(ROOT, "docs/defects"));
const DEFECT_RUNS_DIR = resolve(
  args["defect-runs-dir"] ?? join(ROOT, "docs/defects/example-runs"),
);
const OUT = resolve(args.out ?? join(ROOT, "_site"));
const PAGES_BASE = (env.PAGES_BASE ?? "/qa-automation-lab").replace(/\/$/, "");

// Optional: URL to the Cloudflare Worker (or any HTTPS endpoint) that
// proxies workflow_dispatch + run-status. When set at build time the
// defect-injection panel becomes a live "Run with defects" trigger;
// when absent the panel is read-only and the dispatch button is
// disabled with a "configure DEFECT_DISPATCH_URL" hint.
const DEFECT_DISPATCH_URL = (env.DEFECT_DISPATCH_URL ?? "").trim();

const REPO_URL = "https://github.com/DwonnG/qa-automation-lab";

// Each entry describes a suite card on the dashboard. Order = top-down pyramid.
const SUITES = [
  {
    key: "backend",
    title: "Backend unit + integration",
    layer: "Unit & integration",
    tools: "pytest, FastAPI TestClient",
    artifact: "demo-app-reports",
    junit: "report.xml",
    htmlReport: { artifact: "demo-app-reports", path: "htmlcov" },
    detailMode: "junit",
    sourceHref: `${REPO_URL}/tree/main/demo-app`,
  },
  {
    key: "web-component",
    title: "Frontend component",
    layer: "Component",
    tools: "Vitest, React Testing Library, MSW",
    artifact: "web-junit",
    junit: "junit.xml",
    htmlReport: { artifact: "web-coverage", path: "." },
    detailMode: "junit",
    sourceHref: `${REPO_URL}/tree/main/web/tests`,
  },
  {
    key: "api-e2e",
    title: "API E2E",
    layer: "Service / API",
    tools: "pytest, httpx",
    artifact: "pytest-api-report",
    junit: "report.xml",
    htmlReport: null,
    detailMode: "junit",
    sourceHref: `${REPO_URL}/tree/main/pytest-api`,
  },
  {
    key: "contract",
    title: "API contract",
    layer: "API",
    tools: "Schemathesis 4 (property-based)",
    artifact: "schemathesis-report",
    junit: "report.xml",
    htmlReport: null,
    detailMode: "junit",
    sourceHref: `${REPO_URL}/tree/main/schemathesis`,
  },
  {
    key: "playwright",
    title: "Playwright UI + a11y",
    layer: "UI E2E",
    tools: "Playwright, axe-core",
    artifact: "playwright-report",
    junit: "results.xml",
    // The Playwright job uploads `playwright/playwright-report` as-is,
    // so `actions/upload-artifact` preserves the leaf folder name and
    // the HTML report lives at `<artifact-root>/playwright-report/`.
    htmlReport: { artifact: "playwright-report", path: "playwright-report" },
    detailMode: "html",
    sourceHref: `${REPO_URL}/tree/main/playwright`,
  },
  {
    key: "cypress",
    title: "Cypress UI",
    layer: "UI E2E",
    tools: "Cypress 14, App Actions",
    artifact: "cypress-artifacts",
    junit: "results/*.xml",
    htmlReport: null,
    detailMode: "cypress",
    sourceHref: `${REPO_URL}/tree/main/cypress`,
  },
  {
    key: "perf",
    title: "API load",
    layer: "Integration",
    tools: "k6 (load + SLO thresholds)",
    artifact: "k6-summary",
    junit: null,
    htmlReport: null,
    detailMode: "k6",
    sourceHref: `${REPO_URL}/tree/main/perf`,
  },
];

// ---------------------------------------------------------------------------
// Main (invoked at the bottom of the file so all module-level const
// declarations — TIER_LAYOUT, SUITE_TIER, SUITES, etc. — are
// initialized before any rendering function reaches them).
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(OUT);
  ensureDir(join(OUT, "reports"));
  ensureDir(join(OUT, "data"));

  // Copy static landing assets (styles, 404, favicon if present).
  for (const file of await listFiles(PAGES_DIR)) {
    const rel = relative(PAGES_DIR, file);
    // index.html is generated below; skip if shipped as a placeholder.
    if (rel === "index.html") continue;
    await cp(file, join(OUT, rel), { recursive: false });
  }

  // Copy the live demo build into <out>/demo/.
  if (existsSync(WEB_DIST)) {
    ensureDir(join(OUT, "demo"));
    await cp(WEB_DIST, join(OUT, "demo"), { recursive: true });
  } else {
    console.warn(
      `[build-pages] web dist missing at ${WEB_DIST}; demo will be unavailable`,
    );
    ensureDir(join(OUT, "demo"));
    writeFileSync(join(OUT, "demo", "index.html"), renderMissingDemo());
  }

  const suiteResults = SUITES.map((suite) => collectSuite(suite, ARTIFACTS));
  for (const result of suiteResults) {
    writeSuiteDetail(result);
  }

  const ciMeta = collectCiMeta(ARTIFACTS);
  const totals = aggregate(suiteResults);
  const dashboard = {
    generated_at: new Date().toISOString(),
    ci: ciMeta,
    totals,
    suites: suiteResults.map((r) => publicSuite(r)),
  };

  writeFileSync(
    join(OUT, "data", "dashboard.json"),
    JSON.stringify(dashboard, null, 2) + "\n",
  );

  const defectsCatalog = loadDefectsCatalog();
  writeFileSync(
    join(OUT, "data", "defects.json"),
    JSON.stringify(
      { generated_at: dashboard.generated_at, defects: defectsCatalog },
      null,
      2,
    ) + "\n",
  );

  // Pre-seed /defect-runs/example-<id>/ from docs/defects/example-runs/
  // so the panel has live-looking output to show before anyone clicks
  // the dispatch button.
  if (existsSync(DEFECT_RUNS_DIR)) {
    ensureDir(join(OUT, "defect-runs"));
    for (const entry of readdirSync(DEFECT_RUNS_DIR)) {
      const src = join(DEFECT_RUNS_DIR, entry);
      const dest = join(OUT, "defect-runs", entry);
      try {
        cpRecursiveSync(src, dest);
      } catch (err) {
        console.warn(
          `[build-pages] copy example run ${entry} failed: ${err.message}`,
        );
      }
    }
  }

  writeFileSync(
    join(OUT, "index.html"),
    renderDashboard(dashboard, suiteResults, defectsCatalog),
  );
  console.log(`[build-pages] wrote dashboard to ${OUT}`);
}

// ---------------------------------------------------------------------------
// Artifact collection
// ---------------------------------------------------------------------------

function collectSuite(suite, artifactsDir) {
  const artifactDir = suite.artifact
    ? join(artifactsDir, suite.artifact)
    : null;
  const available = artifactDir ? existsSync(artifactDir) : false;
  const result = {
    ...suite,
    available,
    stats: null,
    cases: [],
    perf: null,
    cypress: null,
    extras: {},
    detailUrl: `${PAGES_BASE}/reports/${suite.key}/`,
  };
  if (!available) return result;

  if (suite.key === "perf") {
    const summaryPath = join(artifactDir, "summary.json");
    if (existsSync(summaryPath)) {
      try {
        result.perf = JSON.parse(readFileSync(summaryPath, "utf8"));
        // Project the k6 threshold result into a single synthetic
        // "test" so the hero status badge, suite count, and the
        // tests/passing/failing/pass-rate tiles reflect a red perf
        // card. Without this, a perf regression is invisible above
        // the fold because aggregate() only sums JUnit stats.
        //
        // time stays 0 on purpose: the "Test time" tile is
        // documented as the sum of <testcase time="..."> across
        // every JUnit suite, and folding in k6's 30 s ramp+hold
        // would muddle that meaning. The perf card itself still
        // shows the full request / latency breakdown.
        result.stats = {
          tests: 1,
          failures: result.perf.thresholds_passed ? 0 : 1,
          errors: 0,
          skipped: 0,
          time: 0,
        };
      } catch (err) {
        console.warn(
          `[build-pages] failed to parse k6 summary: ${err.message}`,
        );
      }
    }
    return result;
  }

  if (suite.junit) {
    const xmlFiles = findJunit(artifactDir, suite.junit);
    let aggregated = null;
    const allCases = [];
    for (const xmlPath of xmlFiles) {
      try {
        const xml = readFileSync(xmlPath, "utf8");
        const parsed = parseJunit(xml);
        aggregated = sumStats(aggregated, parsed.stats);
        allCases.push(...parsed.cases);
      } catch (err) {
        console.warn(
          `[build-pages] failed to parse ${xmlPath}: ${err.message}`,
        );
      }
    }
    result.stats = aggregated;
    result.cases = allCases;
  }

  if (suite.key === "cypress") {
    result.cypress = collectCypressArtifacts(artifactDir);
  }

  return result;
}

function collectCypressArtifacts(dir) {
  return {
    screenshots: existsSync(join(dir, "screenshots"))
      ? walkRel(join(dir, "screenshots"))
      : [],
    videos: existsSync(join(dir, "videos")) ? walkRel(join(dir, "videos")) : [],
  };
}

function collectCiMeta(artifactsDir) {
  // ci-meta artifact carries info written by pages.yml about the triggering run.
  const metaFile = join(artifactsDir, "ci-meta", "meta.json");
  if (existsSync(metaFile)) {
    try {
      return JSON.parse(readFileSync(metaFile, "utf8"));
    } catch (err) {
      console.warn(`[build-pages] failed to read ci-meta: ${err.message}`);
    }
  }
  // Fall back to env vars when invoked from CI without a meta artifact.
  return {
    sha: env.GITHUB_SHA ?? null,
    short_sha: env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : null,
    ref: env.GITHUB_REF ?? null,
    run_id: env.CI_RUN_ID ?? null,
    run_url: env.CI_RUN_URL ?? null,
    triggered_at: env.CI_RUN_AT ?? null,
  };
}

function aggregate(results) {
  const totals = {
    suites_with_data: 0,
    tests: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    duration_sec: 0,
  };
  for (const r of results) {
    if (r.stats) {
      totals.suites_with_data += 1;
      totals.tests += r.stats.tests;
      totals.failures += r.stats.failures;
      totals.errors += r.stats.errors;
      totals.skipped += r.stats.skipped;
      totals.duration_sec += r.stats.time;
    }
  }
  totals.passed = Math.max(
    0,
    totals.tests - totals.failures - totals.errors - totals.skipped,
  );
  totals.pass_rate =
    totals.tests > 0
      ? totals.passed / (totals.tests - totals.skipped || 1)
      : null;
  return totals;
}

function publicSuite(r) {
  return {
    key: r.key,
    title: r.title,
    layer: r.layer,
    tools: r.tools,
    available: r.available,
    stats: r.stats,
    perf: r.perf,
    detail_url: r.detailUrl,
    source_href: r.sourceHref,
  };
}

// ---------------------------------------------------------------------------
// Tier model: the dashboard's pyramid renders one band per architectural
// tier, with one or more "sub-rows" (one per suite) inside each band.
// Every suite lives in a tier — there's no separate "cross-cutting"
// outrigger any more:
//   * Contract (Schemathesis) is API testing with a different strategy
//     (property-based vs example-based), so it joins API E2E in the API
//     tier.
//   * Performance (k6) integrates the deployed API + DB + network and
//     asserts on integrated-system SLOs (p95, error rate) — that's an
//     integration test that happens to use non-functional thresholds
//     instead of functional asserts, so it sits in the Integration tier
//     next to Backend integration.
//
// widthPct: HTML width as a percentage of the pyramid container width.
// UI (top) is narrowest; Unit (base) is widest. This is what gives the
// stack its pyramid silhouette without resorting to clip-path tricks
// that would chew up text inside slanted edges.
// ---------------------------------------------------------------------------

const TIER_LAYOUT = [
  { key: "ui", label: "UI E2E", widthPct: 38 },
  { key: "api", label: "API", widthPct: 54 },
  { key: "component", label: "Component", widthPct: 70 },
  { key: "integration", label: "Integration", widthPct: 86 },
  { key: "unit", label: "Unit", widthPct: 100 },
];

// Map each suite onto its pyramid tier. Multiple suites can map to the
// same tier (UI = Playwright + Cypress, API = API E2E + Schemathesis,
// Integration = Backend integration + k6).
const SUITE_TIER = {
  playwright: "ui",
  cypress: "ui",
  "api-e2e": "api",
  contract: "api",
  perf: "integration",
  // backend is split synthetically below into backend-unit + backend-integration.
  // web-component is split synthetically into a Component row (*.test.tsx)
  // and a Unit row (*.test.ts) — pure-logic vs React component tests.
};

function buildTiers(suiteResults) {
  // Split the backend suite into derived unit + integration rows based on
  // pytest classnames (tests.unit.* vs tests.integration.*). The original
  // backend suite is preserved for the detail page; these are presentation-
  // only projections for the pyramid.
  const splitBackend = splitBackendByClass(
    suiteResults.find((r) => r.key === "backend"),
  );

  // Split the Vitest suite into pure-logic unit tests (*.test.ts → Unit tier)
  // and React component tests (*.test.tsx → Component tier). Mirrors the
  // backend split so the Unit tier gains a "Frontend unit" row to sit
  // alongside "Backend unit".
  const splitWeb = splitWebByExtension(
    suiteResults.find((r) => r.key === "web-component"),
  );

  // Build a flat suite-pool keyed by tier-row identity. Each entry has
  // everything renderSuiteRow needs.
  const rowsByTier = new Map();
  for (const t of TIER_LAYOUT) rowsByTier.set(t.key, []);

  for (const r of suiteResults) {
    if (r.key === "backend") continue; // handled by splitBackend below
    if (r.key === "web-component") continue; // handled by splitWeb below
    const tierKey = SUITE_TIER[r.key];
    if (!tierKey) continue;
    rowsByTier.get(tierKey).push(suiteRowFromResult(r));
  }

  if (splitWeb.component) rowsByTier.get("component").push(splitWeb.component);
  if (splitWeb.unit) rowsByTier.get("unit").push(splitWeb.unit);
  if (splitBackend.unit) rowsByTier.get("unit").push(splitBackend.unit);
  if (splitBackend.integration) {
    rowsByTier.get("integration").push(splitBackend.integration);
  }

  const tiers = TIER_LAYOUT.map((t) => {
    const rows = rowsByTier.get(t.key) ?? [];
    return {
      ...t,
      rows,
      status: aggregateTierStatus(rows),
    };
  });

  return { tiers };
}

function splitBackendByClass(backend) {
  if (!backend || !backend.available || !backend.cases?.length) {
    return { unit: null, integration: null };
  }
  const unitCases = backend.cases.filter((c) =>
    /(^|\.)tests\.unit\./.test(c.classname),
  );
  const integrationCases = backend.cases.filter((c) =>
    /(^|\.)tests\.integration\./.test(c.classname),
  );
  return {
    unit: derivedSubRow(backend, "Backend unit", "pytest", unitCases, {
      sourceHref: `${REPO_URL}/tree/main/demo-app/tests/unit`,
    }),
    integration: derivedSubRow(
      backend,
      "Backend integration",
      "pytest, FastAPI TestClient",
      integrationCases,
      { sourceHref: `${REPO_URL}/tree/main/demo-app/tests/integration` },
    ),
  };
}

// Vitest's JUnit reporter sets classname to the test file path. We split
// the Vitest suite by file extension so React-component tests (.test.tsx,
// which mount components via React Testing Library) feed the Component
// tier, while pure-logic tests (.test.ts, e.g. API client utilities)
// feed the Unit tier. This keeps the Unit tier symmetric with backend:
// both Frontend unit + Backend unit rows live there.
//
// The source-href overrides point each derived row at its dedicated
// directory on disk (web/tests/component vs web/tests/unit) so the ↗
// pill in the dashboard jumps straight to the right files instead of
// to the shared parent tests folder.
function splitWebByExtension(web) {
  if (!web || !web.available || !web.cases?.length) {
    return { component: null, unit: null };
  }
  const componentCases = web.cases.filter((c) =>
    /\.test\.tsx$/.test(c.classname || ""),
  );
  const unitCases = web.cases.filter((c) =>
    /\.test\.ts$/.test(c.classname || ""),
  );
  return {
    component: derivedSubRow(
      web,
      "Frontend component",
      "Vitest, React Testing Library, MSW",
      componentCases,
      { sourceHref: `${REPO_URL}/tree/main/web/tests/component` },
    ),
    unit: derivedSubRow(web, "Frontend unit", "Vitest", unitCases, {
      sourceHref: `${REPO_URL}/tree/main/web/tests/unit`,
    }),
  };
}

// Shared builder for synthetic sub-rows projected off a parent suite.
// Shares detailUrl/key with the parent (they both render off the same
// JUnit report) but accepts per-row overrides for sourceHref so split
// rows can point at their dedicated dir on disk instead of the shared
// parent folder.
function derivedSubRow(parent, title, tools, cases, overrides = {}) {
  if (cases.length === 0) return null;
  const stats = {
    tests: cases.length,
    failures: cases.filter((c) => c.status === "failed").length,
    errors: cases.filter((c) => c.status === "error").length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    time: cases.reduce((sum, c) => sum + (c.time || 0), 0),
  };
  return {
    key: parent.key, // share detail page with parent
    title,
    tools,
    stats,
    detailUrl: parent.detailUrl,
    sourceHref: overrides.sourceHref ?? parent.sourceHref,
    status: suiteStatus(stats),
    available: true,
  };
}

function suiteRowFromResult(r) {
  if (r.key === "perf") {
    return {
      key: r.key,
      title: r.title,
      tools: r.tools,
      perf: r.perf,
      detailUrl: r.detailUrl,
      sourceHref: r.sourceHref,
      status: r.perf
        ? r.perf.thresholds_passed
          ? { label: "thresholds OK", klass: "ok" }
          : { label: "thresholds violated", klass: "bad" }
        : { label: "no data yet", klass: "idle" },
      available: r.available && Boolean(r.perf),
    };
  }
  return {
    key: r.key,
    title: r.title,
    tools: r.tools,
    stats: r.stats,
    detailUrl: r.detailUrl,
    sourceHref: r.sourceHref,
    status: r.stats
      ? suiteStatus(r.stats)
      : { label: "no data yet", klass: "idle" },
    available: r.available && Boolean(r.stats),
  };
}

function aggregateTierStatus(rows) {
  if (rows.length === 0) return { label: "no suite", klass: "idle" };
  if (rows.some((r) => r.status.klass === "bad")) {
    return { label: "failing", klass: "bad" };
  }
  if (rows.every((r) => r.status.klass === "idle")) {
    return { label: "no data yet", klass: "idle" };
  }
  return { label: "passing", klass: "ok" };
}

// ---------------------------------------------------------------------------
// JUnit XML parsing (regex-based, tolerant of extra attributes/namespaces).
// ---------------------------------------------------------------------------

function parseJunit(xml) {
  const stats = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const cases = [];

  for (const ts of matchAll(/<testsuite\b[^>]*>/g, xml)) {
    const attrs = parseAttrs(ts[0]);
    if (attrs.tests !== undefined) {
      stats.tests += toInt(attrs.tests);
      stats.failures += toInt(attrs.failures);
      stats.errors += toInt(attrs.errors);
      stats.skipped += toInt(attrs.skipped);
      stats.time += toFloat(attrs.time);
    }
  }
  // Fallback when testsuites lack aggregates (rare); count testcase nodes.
  if (stats.tests === 0) {
    for (const _tc of matchAll(/<testcase\b[^>]*\/?>/g, xml)) {
      stats.tests += 1;
    }
  }

  // Full per-case extraction (open/self-closed tags).
  const caseRegex = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRegex.exec(xml)) !== null) {
    const attrs = parseAttrs(`<x ${m[1]}>`);
    const inner = m[3] ?? "";
    let status = "passed";
    let message = "";
    if (/<failure\b/.test(inner)) {
      status = "failed";
      message = extractInner(inner, "failure");
    } else if (/<error\b/.test(inner)) {
      status = "error";
      message = extractInner(inner, "error");
    } else if (/<skipped\b/.test(inner)) {
      status = "skipped";
      message = extractInner(inner, "skipped");
    }
    cases.push({
      classname: attrs.classname ?? "",
      name: attrs.name ?? "",
      time: toFloat(attrs.time),
      status,
      message,
    });
  }

  // If aggregates were missing, derive failure/error/skipped from per-case.
  if (stats.failures === 0 && stats.errors === 0 && stats.skipped === 0) {
    for (const c of cases) {
      if (c.status === "failed") stats.failures += 1;
      else if (c.status === "error") stats.errors += 1;
      else if (c.status === "skipped") stats.skipped += 1;
    }
  }

  return { stats, cases };
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /(\w[\w:.-]*)\s*=\s*"([^"]*)"|(\w[\w:.-]*)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    attrs[key] = decodeXml(value);
  }
  return attrs;
}

function extractInner(xml, tag) {
  const open = new RegExp(`<${tag}\\b([^>]*)(\\/>|>([\\s\\S]*?)<\\/${tag}>)`);
  const m = xml.match(open);
  if (!m) return "";
  if (m[2] === "/>") {
    const attrs = parseAttrs(`<x ${m[1]}>`);
    return attrs.message ?? "";
  }
  const attrs = parseAttrs(`<x ${m[1]}>`);
  const body = decodeXml(stripCdata(m[3] ?? ""));
  return [attrs.message, body].filter(Boolean).join("\n").trim();
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sumStats(a, b) {
  if (!a) return { ...b };
  return {
    tests: a.tests + b.tests,
    failures: a.failures + b.failures,
    errors: a.errors + b.errors,
    skipped: a.skipped + b.skipped,
    time: a.time + b.time,
  };
}

function toInt(v) {
  const n = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}
function toFloat(v) {
  const n = Number.parseFloat(v ?? "0");
  return Number.isFinite(n) ? n : 0;
}
function matchAll(re, s) {
  return [...s.matchAll(re)];
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

async function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path ?? dir, e.name));
}

function findJunit(root, pattern) {
  // Supports a literal filename or a single "results/*.xml" style glob.
  //
  // For literal filenames we first try the artifact root and then fall
  // back to a recursive walk by basename. The walk handles the case
  // where `actions/upload-artifact` preserves a leaf directory name
  // inside the archive (e.g. `playwright-report/results.xml` instead
  // of just `results.xml` at the root). Without this fallback the
  // parser silently reports the suite as available-but-empty, which is
  // exactly how Playwright stats went missing on the live dashboard.
  if (!pattern.includes("*")) {
    const candidate = join(root, pattern);
    if (existsSync(candidate)) return [candidate];
    if (!existsSync(root)) return [];
    return walk(root).filter((f) => basename(f) === pattern);
  }
  const [subdir, glob] = pattern.split("/");
  const dir = join(root, subdir);
  if (!existsSync(dir)) return [];
  const ext = glob.replace(/^\*/, "");
  return walk(dir).filter((f) => f.endsWith(ext));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSyncSafe(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function walkRel(dir) {
  return walk(dir).map((f) => relative(dir, f));
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function parseArgs(argList) {
  const out = {};
  for (let i = 0; i < argList.length; i++) {
    const arg = argList[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argList[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderDashboard(data, suiteResults, defectsCatalog = []) {
  const { totals, ci } = data;
  const updated = new Date(data.generated_at);
  const overall = overallStatus(totals);
  return baseLayout({
    title: "qa-automation-lab dashboard",
    extraMeta: `
      <meta name="defect-dispatch-url" content="${escapeAttr(DEFECT_DISPATCH_URL)}" />
      <meta name="defect-runs-base" content="${escapeAttr(`${PAGES_BASE}/defect-runs/`)}" />
    `,
    body: `
      <header class="hero">
        <div class="hero-inner">
          <div class="hero-intro">
            ${renderStatusBadge(overall, totals, ci, updated)}
          </div>
          <h1 class="hero-title">qa-automation-lab</h1>
          <p class="hero-lead">
            A self-contained, multi-framework test automation lab demonstrating
            a <strong>full test pyramid</strong> &mdash; from pure-logic units
            up through component, integration (including k6 load),
            API (including Schemathesis contract), and UI E2E coverage &mdash;
            against one bundled React + FastAPI
            <a href="#sut">system under test</a>.
          </p>
          <div class="hero-actions">
            <a class="btn btn--primary" href="${PAGES_BASE}/demo/">
              <span>Try the SUT</span>
              <span class="btn-aside">Live &middot; PIN 000000</span>
            </a>
            <a class="btn btn--ghost" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">View on GitHub</a>
            <a class="btn btn--ghost" href="${REPO_URL}/actions" target="_blank" rel="noopener noreferrer">CI runs &rarr;</a>
          </div>
          ${renderHeroMetrics(totals, ci)}
          ${renderHeroMeta(ci, updated)}
        </div>
      </header>

      <main id="main">
        <section class="section section--compact" id="pyramid">
          <div class="section-head">
            <p class="eyebrow"><span class="eyebrow-num">01</span> Coverage</p>
            <h2>The pyramid, live</h2>
            <p class="section-desc">
              Five tiers, nine suites — every count comes from JUnit XML or
              the k6 summary published by the latest CI run on <code>main</code>.
              Tap a row for the report; ↗ jumps to source.
            </p>
          </div>
          ${renderPyramidDashboard(buildTiers(suiteResults))}
        </section>

        ${renderDefectsSection(defectsCatalog)}

        <section class="section" id="sut">
          <div class="section-head">
            <p class="eyebrow"><span class="eyebrow-num">03</span> System under test</p>
            <h2>The app the suites target</h2>
            <p class="section-desc">
              Every count above came from running tests against this exact
              React + FastAPI app. The button below opens the React half so you
              can poke the same screens Playwright, Cypress, axe, and Vitest
              exercise.
            </p>
          </div>
          <div class="about-card">
            <p>
              On GitHub Pages the SPA talks to
              <a href="https://mswjs.io/" target="_blank" rel="noopener noreferrer">MSW</a>
              handlers that mirror the real OpenAPI contract &mdash; that's the
              only way to keep it interactive on a static host. In CI the same
              React build runs against the real FastAPI process, and that's
              where the suite results above come from.
            </p>
            <p>
              Sign in with PIN <code>000000</code> &mdash; the hero button at
              the top opens the SUT in a new context. State is
              per-browser-session and resets on refresh. To run the real stack
              locally (single port, FastAPI serving the SPA),
              <code>docker compose up</code> from the repo.
            </p>
          </div>
        </section>
      </main>

      <footer class="footer">
        <p>
          Built by
          <a href="https://dwgoodwi.github.io" target="_blank" rel="noopener noreferrer">Dwonn Goodwin</a>
          &middot; MIT licensed &middot;
          <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">source</a>
          &middot; data:
          <a href="${PAGES_BASE}/data/dashboard.json">dashboard.json</a>
        </p>
      </footer>
    `,
  });
}

function renderStatusBadge(overall, totals, ci, updated) {
  // Live "All suites passing on main" pill matching the portfolio's
  // availability-badge shape (pulse dot + text), recolored by status.
  const suffix =
    totals.suites_with_data > 0
      ? ` &middot; ${formatInt(totals.suites_with_data)} suite${totals.suites_with_data === 1 ? "" : "s"} on <code>main</code>`
      : "";
  const ago = ci?.triggered_at
    ? humanAgo(new Date(ci.triggered_at))
    : humanAgo(updated);
  return `
    <div class="status-badge status-badge--${overall.klass}">
      <span class="pulse" aria-hidden="true"></span>
      <strong>${overall.label}</strong>${suffix}
      <span style="color:var(--text-tertiary)">&middot; ${escapeHtml(ago)}</span>
    </div>
  `;
}

function renderHeroMetrics(totals, ci) {
  const passRate =
    totals.pass_rate === null ? "—" : `${(totals.pass_rate * 100).toFixed(1)}%`;
  const failing = totals.failures + totals.errors;

  // "Test time" is the sum of every <testcase time="..."> across every
  // suite, which is informative but NOT what a contributor sees in CI.
  // The pages workflow records the triggering CI run's wall-clock
  // duration in ci-meta so we can render the real pipeline time too.
  // The wall-clock tile is hidden when meta lacks the value (older
  // dashboards, manual-dispatch runs without a resolved CI run, etc.)
  // so the layout stays clean at 5 tiles.
  const wallClock =
    typeof ci?.wall_clock_sec === "number" && ci.wall_clock_sec > 0
      ? formatDuration(ci.wall_clock_sec)
      : null;
  const wallClockTile = wallClock
    ? `
      <div class="metric" title="End-to-end wall-clock time for the CI pipeline that produced these reports.">
        <span class="metric-value">${wallClock}</span>
        <span class="metric-label">Wall-clock</span>
      </div>`
    : "";

  // Skipped is hidden when 0 to avoid an always-noisy "—" tile. When the
  // pyramid splits backend by classname some pytest markers (e.g. perf-
  // marked tests) get skipped, and that needs to be visible so the
  // pass-rate math reconciles.
  const skippedTile =
    totals.skipped > 0
      ? `
      <div class="metric" title="Tests reported as skipped by JUnit. Pass rate is computed as passed / (tests − skipped).">
        <span class="metric-value">${formatInt(totals.skipped)}</span>
        <span class="metric-label">Skipped</span>
      </div>`
      : "";

  return `
    <div class="metrics" aria-label="Aggregate test status">
      <div class="metric">
        <span class="metric-value">${formatInt(totals.tests)}</span>
        <span class="metric-label">Tests</span>
      </div>
      <div class="metric ${totals.passed > 0 && failing === 0 ? "metric--ok" : ""}">
        <span class="metric-value">${formatInt(totals.passed)}</span>
        <span class="metric-label">Passing</span>
      </div>
      <div class="metric ${failing > 0 ? "metric--bad" : ""}">
        <span class="metric-value">${formatInt(failing)}</span>
        <span class="metric-label">Failing</span>
      </div>
      ${skippedTile}
      <div class="metric">
        <span class="metric-value">${passRate}</span>
        <span class="metric-label">Pass rate</span>
      </div>
      <div class="metric" title="Sum of every JUnit <testcase> time across every suite. Suites run in parallel CI jobs, so this is greater than the wall-clock pipeline time.">
        <span class="metric-value">${formatDuration(totals.duration_sec)}</span>
        <span class="metric-label">Test time</span>
      </div>
      ${wallClockTile}
    </div>
  `;
}

function renderHeroMeta(ci, updated) {
  const sha = ci?.short_sha
    ? `<a href="${REPO_URL}/commit/${escapeAttr(ci.sha)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(ci.short_sha)}</code></a>`
    : "<code>—</code>";
  const runLink = ci?.run_url
    ? `<a href="${escapeAttr(ci.run_url)}" target="_blank" rel="noopener noreferrer">run #${escapeHtml(String(ci.run_id ?? ""))}</a>`
    : "—";
  return `
    <p class="hero-meta">
      Updated ${escapeHtml(updated.toUTCString())} &middot; commit ${sha} &middot; ${runLink}
    </p>
  `;
}

// ---------------------------------------------------------------------------
// renderPyramidDashboard
//
// Single section that replaces the earlier separate "Suites in the pyramid"
// grid + "How the lab is shaped" SVG. The pyramid IS the dashboard: each
// architectural tier is a band sized as a percentage of the container width
// (38% top → 100% bottom), and each band hosts one or more suite sub-rows
// with live stats and click-through to the full report.
//
// Every suite now lives in a tier (Schemathesis → API, k6 → Integration);
// the earlier cross-cutting outrigger is gone, so the pyramid takes the
// full content width.
// ---------------------------------------------------------------------------

function renderPyramidDashboard({ tiers }) {
  const totalSuites = tiers.reduce((sum, t) => sum + t.rows.length, 0);
  const totalTiersWithSuites = tiers.filter((t) => t.rows.length > 0).length;

  return `
    <div class="lab-pyramid">
      <div class="lab-pyramid-cap">
        <span class="eyebrow eyebrow--tiny" aria-hidden="true">Targets the SUT &darr;</span>
        <p class="lab-pyramid-title">
          ${totalTiersWithSuites} architectural tier${totalTiersWithSuites === 1 ? "" : "s"} &middot;
          ${totalSuites} suite${totalSuites === 1 ? "" : "s"}
        </p>
      </div>
      <ol class="lab-pyramid-stack" aria-label="Test pyramid tiers, narrowest at top">
        ${tiers.map(renderTierBand).join("\n")}
      </ol>
    </div>
  `;
}

// (Earlier iterations rendered a separate SVG pyramid backdrop. We
// dropped it because its fixed 1/5 vertical stripes never aligned with
// the bands' actual heights — multi-suite tiers like UI are taller than
// single-suite tiers, so the slice boundaries always landed mid-band.
// The pyramid identity now comes from the bands themselves: per-tier
// gradient backgrounds matching the portfolio's slate→wine hero
// pyramid, plus width gradation that makes the silhouette obvious at
// a glance.)

function renderTierBand(tier) {
  const hasRows = tier.rows.length > 0;
  return `
    <li
      class="lab-tier lab-tier--${tier.key} lab-tier--${tier.status.klass} ${hasRows && tier.rows.length > 1 ? "lab-tier--multi" : ""}"
      style="--w: ${tier.widthPct}%"
    >
      <div class="lab-tier-head">
        <div class="lab-tier-id">
          <span class="lab-tier-name">${escapeHtml(tier.label)}</span>
          ${
            hasRows
              ? `<span class="lab-tier-count">${tier.rows.length} suite${tier.rows.length === 1 ? "" : "s"}</span>`
              : `<span class="lab-tier-count lab-tier-count--idle">no suite yet</span>`
          }
        </div>
        <span class="status-chip status-chip--${tier.status.klass}">${escapeHtml(tier.status.label)}</span>
      </div>
      ${
        hasRows
          ? `<ul class="lab-tier-rows">${tier.rows.map(renderTierRow).join("")}</ul>`
          : `<p class="lab-tier-empty">Reserved for future <code>${escapeHtml(tier.label)}</code> coverage.</p>`
      }
    </li>
  `;
}

function renderTierRow(row) {
  // Perf rows (k6) carry a `perf` shape instead of JUnit `stats` because
  // load tests assert on non-functional thresholds (p95 ms, error rate)
  // rather than functional pass/fail per test case. Render them with the
  // same card chrome as functional rows but swap the stat strip.
  const statsHtml = row.perf
    ? renderPerfStats(row.perf)
    : renderFunctionalStats(row.stats);

  return `
    <li class="lab-row lab-row--${row.status.klass}">
      <a class="lab-row-primary" href="${escapeAttr(row.detailUrl)}" aria-label="Open ${escapeAttr(row.title)} report">
        <div class="lab-row-id">
          <span class="lab-row-name">${escapeHtml(row.title)}</span>
          <span class="lab-row-tools">${escapeHtml(row.tools)}</span>
        </div>
        <div class="lab-row-stats" role="presentation">
          ${statsHtml}
        </div>
      </a>
      <a
        class="lab-row-source"
        href="${escapeAttr(row.sourceHref)}"
        target="_blank"
        rel="noopener noreferrer"
        title="Open ${escapeAttr(row.title)} source on GitHub"
      >
        <span aria-hidden="true">${"\u2197"}</span>
        <span class="visually-hidden">Open ${escapeHtml(row.title)} source on GitHub</span>
      </a>
    </li>
  `;
}

function renderFunctionalStats(stats) {
  stats = stats ?? { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const passing = passedCount(stats);
  const failing = stats.failures + stats.errors;
  const denom = Math.max(stats.tests - stats.skipped, 1);
  const passPct = stats.tests > 0 ? Math.round((passing / denom) * 100) : null;

  const failChip =
    failing > 0
      ? `<span class="lab-row-stat lab-row-stat--bad"><strong>${formatInt(failing)}</strong> <em>fail</em></span>`
      : "";
  const skipChip =
    stats.skipped > 0
      ? `<span class="lab-row-stat lab-row-stat--idle"><strong>${formatInt(stats.skipped)}</strong> <em>skip</em></span>`
      : "";
  const passChip =
    passPct !== null
      ? `<span class="lab-row-stat lab-row-stat--accent"><strong>${passPct}%</strong> <em>pass</em></span>`
      : "";

  return `
    <span class="lab-row-stat"><strong>${formatInt(stats.tests)}</strong> <em>tests</em></span>
    ${failChip}
    ${skipChip}
    ${passChip}
  `;
}

// k6 thresholds drive the binary pass/fail verdict; the headline perf
// numbers (reqs, p95, error rate) replace the tests/pass% pair used by
// functional rows. Error chip recolors when the failed-request rate is
// non-zero so a degraded run is obvious even before the threshold flips.
function renderPerfStats(perf) {
  if (!perf) {
    return `<span class="lab-row-stat lab-row-stat--idle"><strong>—</strong> <em>no run</em></span>`;
  }
  const errKlass = perf.failed_rate > 0 ? "lab-row-stat--bad" : "";
  return `
    <span class="lab-row-stat"><strong>${formatInt(perf.request_count ?? 0)}</strong> <em>reqs</em></span>
    <span class="lab-row-stat"><strong>${formatMs(perf.p95_ms)}</strong> <em>p95</em></span>
    <span class="lab-row-stat ${errKlass}"><strong>${formatPct(perf.failed_rate)}</strong> <em>err</em></span>
  `;
}

// (The earlier cross-cutting outrigger renderers — renderCrossCutOutrigger,
// renderCrossCutCard, renderCrossCutContractCard, renderCrossCutPerfCard,
// and the CROSSCUT_EYEBROWS map — were removed when Schemathesis moved
// into the API tier and k6 moved into the Integration tier. Their CSS
// classes (.lab-crosscut*, .lab-cross-card*) remain in styles.css only
// because the detail pages still reference some of the .lab-cross-* atoms;
// nothing on the dashboard renders them any more.)

// ---------------------------------------------------------------------------
// Defect injection panel
//
// loadDefectsCatalog() parses docs/defects/*.md frontmatter (a tiny YAML
// subset: key/value scalars + the `caught_by` list). renderDefectsSection()
// emits the chooser UI. The actual dispatch + polling logic lives in
// pages/dispatch.js and reads metadata from <meta> tags injected here.
// ---------------------------------------------------------------------------

function loadDefectsCatalog() {
  if (!existsSync(DEFECTS_DIR)) return [];
  const out = [];
  for (const name of readdirSync(DEFECTS_DIR)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const full = join(DEFECTS_DIR, name);
    try {
      const raw = readFileSync(full, "utf8");
      const meta = parseFrontmatter(raw);
      if (!meta?.id) continue;
      out.push(meta);
    } catch (err) {
      console.warn(`[build-pages] skip defect ${name}: ${err.message}`);
    }
  }
  // Stable order: same as KNOWN_DEFECTS in web/src/lib/defects.ts so the
  // panel and the in-browser SUT toggle list match top-to-bottom.
  const order = [
    "login_accepts_any_pin",
    "negative_qty_allowed",
    "off_by_one_pagination",
    "delete_skips_auth",
    "slow_query",
  ];
  out.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return out;
}

// Tiny YAML-subset parser: enough for the frontmatter shape used by the
// defect catalog (scalar key: value, multiline `|` blocks, list of
// objects under `caught_by:`). Refuses anything more exotic.
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const lines = m[1].split("\n");
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    let value = kv[2].trim();
    if (value === "|") {
      // Block scalar: consume indented lines.
      const block = [];
      i += 1;
      while (i < lines.length && /^\s{2,}/.test(lines[i])) {
        block.push(lines[i].replace(/^\s{2}/, ""));
        i += 1;
      }
      out[key] = block.join("\n").trim();
      continue;
    }
    if (value === "") {
      // Could be a list: peek next line for `  - `.
      if (i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1])) {
        const items = [];
        i += 1;
        while (i < lines.length && /^\s*-\s/.test(lines[i])) {
          // List item; collect nested key: value pairs until next `-` or
          // end of indented block.
          const item = {};
          const first = lines[i].replace(/^\s*-\s*/, "");
          if (first.includes(":")) {
            const fk = first.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
            if (fk) item[fk[1]] = fk[2].trim();
          }
          i += 1;
          while (
            i < lines.length &&
            /^\s{4,}/.test(lines[i]) &&
            !/^\s*-/.test(lines[i])
          ) {
            const nk = lines[i].match(/^\s+([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
            if (nk) item[nk[1]] = nk[2].trim();
            i += 1;
          }
          items.push(item);
        }
        out[key] = items;
        continue;
      }
    }
    // Strip surrounding quotes; coerce true/false.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") value = true;
    else if (value === "false") value = false;
    out[key] = value;
    i += 1;
  }
  return out;
}

const TIER_LABELS = {
  ui: "UI E2E",
  api: "API",
  component: "Component",
  integration: "Integration",
  unit: "Unit",
};

function renderDefectsSection(catalog) {
  if (catalog.length === 0) return "";
  const live = Boolean(DEFECT_DISPATCH_URL);
  const helpText = live
    ? "Pick one or more defects and dispatch a real CI run. The matching tier band(s) will flip when the run completes; an AI-written explanation appears below."
    : "This deploy is read-only: <code>DEFECT_DISPATCH_URL</code> isn't configured, so the panel can't fire a workflow. Pre-seeded example runs are available below.";
  const rows = catalog
    .map((d) => {
      const tier = TIER_LABELS[d.tier] || escapeHtml(d.tier || "");
      const summary = escapeHtml(
        (d.summary || "").split("\n").slice(0, 2).join(" ").slice(0, 240),
      );
      return `
        <li class="defect-row" data-defect-id="${escapeAttr(d.id)}" data-tier="${escapeAttr(d.tier || "")}">
          <label class="defect-row-toggle">
            <input
              type="checkbox"
              name="defect"
              value="${escapeAttr(d.id)}"
              data-testid="defect-check-${escapeAttr(d.id)}"
              ${live ? "" : "disabled"}
            />
            <div class="defect-row-body">
              <div class="defect-row-head">
                <code class="defect-row-id">${escapeHtml(d.id)}</code>
                <span class="defect-row-tier">${escapeHtml(tier)} tier</span>
                ${
                  d.visible_in_browser
                    ? `<span class="defect-row-flag" title="Toggle the in-browser SUT to see this defect immediately">in-browser</span>`
                    : ""
                }
              </div>
              <p class="defect-row-summary">${summary}</p>
            </div>
          </label>
          <div class="defect-row-actions">
            <a class="defect-row-link" href="${REPO_URL}/blob/main/docs/defects/${escapeAttr(d.id)}.md" target="_blank" rel="noopener noreferrer" title="Read the full defect spec">spec ↗</a>
            <a class="defect-row-link" href="${PAGES_BASE}/defect-runs/example-${escapeAttr(d.id)}/" data-defect-example="${escapeAttr(d.id)}">example run</a>
          </div>
        </li>
      `;
    })
    .join("\n");

  return `
    <section class="section section--compact" id="defects">
      <div class="section-head">
        <p class="eyebrow"><span class="eyebrow-num">02</span> Defect injection</p>
        <h2>Flip a bug, watch the pyramid catch it</h2>
        <p class="section-desc">${helpText}</p>
      </div>
      <div class="defect-panel" data-live="${live ? "true" : "false"}">
        <ol class="defect-list">${rows}</ol>
        <div class="defect-panel-footer">
          <button
            type="button"
            class="btn btn--primary defect-run-btn"
            data-testid="defect-run-btn"
            ${live ? "" : "disabled"}
          >
            ${live ? "Run with selected defects" : "Configure DEFECT_DISPATCH_URL to enable"}
          </button>
          <p class="defect-panel-status" data-defect-status role="status" aria-live="polite"></p>
        </div>
        <div class="defect-panel-result" hidden data-defect-result></div>
      </div>
    </section>
  `;
}

function humanAgo(date) {
  if (!date || isNaN(date.getTime())) return "just now";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// --- Per-suite detail pages ------------------------------------------------

function writeSuiteDetail(suite) {
  const dir = join(OUT, "reports", suite.key);
  ensureDir(dir);

  // 1) Copy any external HTML report verbatim into <dir>/full/ so suite pages
  //    can frame or link to it. We avoid clobbering generated index.html.
  if (suite.htmlReport && suite.available) {
    const srcRoot = join(ARTIFACTS, suite.htmlReport.artifact);
    const src =
      suite.htmlReport.path === "."
        ? srcRoot
        : join(srcRoot, suite.htmlReport.path);
    if (existsSync(src)) {
      const dest = join(dir, "full");
      ensureDir(dest);
      try {
        cpRecursiveSync(src, dest);
      } catch (err) {
        console.warn(
          `[build-pages] copy ${src} -> ${dest} failed: ${err.message}`,
        );
      }
    }
  }

  // 2) Generate a suite-specific index.html.
  let body;
  if (suite.detailMode === "k6") body = renderPerfDetail(suite);
  else if (suite.detailMode === "cypress") body = renderCypressDetail(suite);
  else if (suite.detailMode === "html") body = renderHtmlEmbedDetail(suite);
  else body = renderJunitDetail(suite);

  writeFileSync(
    join(dir, "index.html"),
    baseLayout({
      title: `${suite.title} \u00b7 qa-automation-lab`,
      body: `
        <main class="detail" id="main">
          <p class="breadcrumb">
            <a href="${PAGES_BASE}/">
              <span aria-hidden="true">&larr;</span>
              <span>Back to dashboard</span>
            </a>
          </p>
          ${body}
        </main>
      `,
    }),
  );
}

function renderJunitDetail(suite) {
  if (!suite.available || !suite.stats) {
    return renderEmptyDetail(
      suite,
      "No JUnit XML uploaded yet for this suite.",
    );
  }
  const status = suiteStatus(suite.stats);
  const passed = passedCount(suite.stats);
  const failedTotal = suite.stats.failures + suite.stats.errors;
  const failures = suite.cases.filter(
    (c) => c.status === "failed" || c.status === "error",
  );
  const allRows = suite.cases
    .map(
      (c) => `
        <tr class="case-${c.status}">
          <td><code>${escapeHtml(c.classname || "")}</code></td>
          <td>${escapeHtml(c.name || "")}</td>
          <td>${escapeHtml(c.status)}</td>
          <td class="num">${formatDuration(c.time)}</td>
        </tr>
      `,
    )
    .join("");
  const failureBlocks = failures
    .map(
      (c) => `
        <details class="failure">
          <summary>
            <span class="status-chip is-bad">${escapeHtml(c.status)}</span>
            <code>${escapeHtml(c.classname || "")}</code> &middot; ${escapeHtml(c.name || "")}
          </summary>
          <pre>${escapeHtml(c.message || "(no message)")}</pre>
        </details>
      `,
    )
    .join("");
  const htmlLink =
    suite.htmlReport &&
    existsSync(join(OUT, "reports", suite.key, "full", "index.html"))
      ? `<a class="btn btn--ghost" href="./full/">Open native HTML report &rarr;</a>`
      : "";
  return `
    ${renderDetailHead(suite, htmlLink)}
    ${renderDetailMetrics(suite.stats, status, passed, failedTotal)}
    ${failures.length > 0 ? `<section><h2>Failures</h2>${failureBlocks}</section>` : ""}
    <section>
      <h2>All cases</h2>
      <div class="table-wrap">
        <table class="cases">
          <thead><tr><th>Classname</th><th>Name</th><th>Status</th><th>Duration</th></tr></thead>
          <tbody>${allRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderHtmlEmbedDetail(suite) {
  if (!suite.available) {
    return renderEmptyDetail(suite, "No Playwright report uploaded yet.");
  }
  const hasHtml = existsSync(
    join(OUT, "reports", suite.key, "full", "index.html"),
  );
  const status = suite.stats
    ? suiteStatus(suite.stats)
    : { label: "—", klass: "idle" };
  const passed = suite.stats ? passedCount(suite.stats) : 0;
  const failedTotal = suite.stats
    ? suite.stats.failures + suite.stats.errors
    : 0;
  const primaryCta = hasHtml
    ? `<a class="btn btn--primary" href="./full/">Open the Playwright HTML report &rarr;</a>`
    : "";
  return `
    ${renderDetailHead(suite, primaryCta)}
    ${suite.stats ? renderDetailMetrics(suite.stats, status, passed, failedTotal) : ""}
    ${
      hasHtml
        ? `<section class="section--bleed"><h2>Native report</h2><div class="embed-wrap"><iframe src="./full/" title="Playwright HTML report" loading="lazy"></iframe></div></section>`
        : ""
    }
  `;
}

function renderCypressDetail(suite) {
  if (!suite.available) {
    return renderEmptyDetail(suite, "No Cypress run uploaded yet.");
  }
  const status = suite.stats
    ? suiteStatus(suite.stats)
    : { label: "—", klass: "idle" };
  const passed = suite.stats ? passedCount(suite.stats) : 0;
  const failedTotal = suite.stats
    ? suite.stats.failures + suite.stats.errors
    : 0;
  const screenshots = suite.cypress?.screenshots ?? [];
  const videos = suite.cypress?.videos ?? [];
  const screenshotGallery = screenshots.length
    ? screenshots
        .map(
          (rel) => `
            <figure>
              <img src="./assets/screenshots/${escapeAttr(rel.split("/").map(encodeURIComponent).join("/"))}" alt="${escapeAttr(rel)}" loading="lazy" />
              <figcaption>${escapeHtml(rel)}</figcaption>
            </figure>`,
        )
        .join("")
    : `<p class="suite-empty">No failure screenshots from the latest run.</p>`;
  const videoGallery = videos.length
    ? videos
        .map(
          (rel) => `
            <figure>
              <video src="./assets/videos/${escapeAttr(rel.split("/").map(encodeURIComponent).join("/"))}" controls preload="metadata"></video>
              <figcaption>${escapeHtml(rel)}</figcaption>
            </figure>`,
        )
        .join("")
    : "";
  // Copy screenshots/videos to the published reports dir.
  if (suite.cypress) {
    const root = join(ARTIFACTS, suite.artifact);
    if (existsSync(join(root, "screenshots"))) {
      cpRecursiveSync(
        join(root, "screenshots"),
        join(OUT, "reports", suite.key, "assets", "screenshots"),
      );
    }
    if (existsSync(join(root, "videos"))) {
      cpRecursiveSync(
        join(root, "videos"),
        join(OUT, "reports", suite.key, "assets", "videos"),
      );
    }
  }
  // Stitch the JUnit table/failures back in (excluding its head + metrics).
  const tail = renderJunitTail(suite);
  return `
    ${renderDetailHead(suite, "")}
    ${suite.stats ? renderDetailMetrics(suite.stats, status, passed, failedTotal) : ""}
    ${videos.length ? `<section><h2>Videos</h2><div class="media-grid">${videoGallery}</div></section>` : ""}
    <section><h2>Failure screenshots</h2><div class="media-grid">${screenshotGallery}</div></section>
    ${tail}
  `;
}

// Failures + cases table portion of a JUnit detail page, used by Cypress
// to append spec-by-spec results below the media galleries without
// re-rendering the head/metrics block.
function renderJunitTail(suite) {
  if (!suite.available || !suite.stats) return "";
  const failures = suite.cases.filter(
    (c) => c.status === "failed" || c.status === "error",
  );
  const allRows = suite.cases
    .map(
      (c) => `
        <tr class="case-${c.status}">
          <td><code>${escapeHtml(c.classname || "")}</code></td>
          <td>${escapeHtml(c.name || "")}</td>
          <td>${escapeHtml(c.status)}</td>
          <td class="num">${formatDuration(c.time)}</td>
        </tr>`,
    )
    .join("");
  const failureBlocks = failures
    .map(
      (c) => `
        <details class="failure">
          <summary>
            <span class="status-chip is-bad">${escapeHtml(c.status)}</span>
            <code>${escapeHtml(c.classname || "")}</code> &middot; ${escapeHtml(c.name || "")}
          </summary>
          <pre>${escapeHtml(c.message || "(no message)")}</pre>
        </details>`,
    )
    .join("");
  if (allRows === "") return "";
  return `
    ${failures.length > 0 ? `<section><h2>Failures</h2>${failureBlocks}</section>` : ""}
    <section>
      <h2>All cases</h2>
      <div class="table-wrap">
        <table class="cases">
          <thead><tr><th>Classname</th><th>Name</th><th>Status</th><th>Duration</th></tr></thead>
          <tbody>${allRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPerfDetail(suite) {
  if (!suite.perf) {
    return renderEmptyDetail(suite, "No k6 summary uploaded yet.");
  }
  const p = suite.perf;
  const okBad = p.thresholds_passed ? "ok" : "bad";
  return `
    ${renderDetailHead(suite, "")}
    <div class="metrics" style="margin-top:0;border-top:none;padding-top:0">
      <div class="metric metric--${okBad}">
        <span class="metric-value">${p.thresholds_passed ? "OK" : "violated"}</span>
        <span class="metric-label">Thresholds</span>
      </div>
      <div class="metric"><span class="metric-value">${formatInt(p.request_count ?? 0)}</span><span class="metric-label">Requests</span></div>
      <div class="metric ${p.failed_rate > 0 ? "metric--bad" : "metric--ok"}"><span class="metric-value">${formatPct(p.failed_rate)}</span><span class="metric-label">Error rate</span></div>
      <div class="metric"><span class="metric-value">${formatMs(p.avg_ms)}</span><span class="metric-label">avg</span></div>
      <div class="metric"><span class="metric-value">${formatMs(p.p95_ms)}</span><span class="metric-label">p95</span></div>
    </div>
    <div class="metrics" style="margin-top:0.85rem;border-top:none;padding-top:0">
      <div class="metric"><span class="metric-value">${formatMs(p.p99_ms)}</span><span class="metric-label">p99</span></div>
      <div class="metric"><span class="metric-value">${formatMs(p.max_ms)}</span><span class="metric-label">max</span></div>
    </div>
    ${p.timestamp ? `<p class="hero-meta" style="margin-top:1.5rem">Sample taken ${escapeHtml(p.timestamp)}</p>` : ""}
  `;
}

function renderEmptyDetail(suite, msg) {
  return `
    ${renderDetailHead(suite, `<a class="btn btn--ghost" href="${REPO_URL}/actions" target="_blank" rel="noopener noreferrer">Trigger a CI run &rarr;</a>`)}
    <div class="about-card">
      <p>${escapeHtml(msg)}</p>
    </div>
  `;
}

function renderDetailHead(suite, ctaHtml) {
  const layerNo =
    {
      backend: "01",
      "web-component": "02",
      "api-e2e": "03",
      contract: "04",
      playwright: "05",
      cypress: "06",
      perf: "07",
    }[suite.key] ?? "•";
  return `
    <header class="detail-head">
      <p class="eyebrow"><span class="eyebrow-num">${layerNo}</span> ${escapeHtml(suite.layer)}</p>
      <h1>${escapeHtml(suite.title)}</h1>
      <p class="lede">
        ${escapeHtml(suite.tools)}
        &middot;
        <a href="${escapeAttr(suite.sourceHref)}" target="_blank" rel="noopener noreferrer">source on GitHub &rarr;</a>
      </p>
      ${ctaHtml ? `<div class="hero-actions">${ctaHtml}</div>` : ""}
    </header>
  `;
}

function renderDetailMetrics(stats, status, passed, failedTotal) {
  const passRate =
    stats.tests > 0
      ? `${Math.round((passed / Math.max(1, stats.tests - stats.skipped)) * 100)}%`
      : "—";
  return `
    <div class="metrics" style="margin-top:0;border-top:none;padding-top:0">
      <div class="metric"><span class="metric-value">${formatInt(stats.tests)}</span><span class="metric-label">Tests</span></div>
      <div class="metric ${status.klass === "ok" ? "metric--ok" : ""}"><span class="metric-value">${formatInt(passed)}</span><span class="metric-label">Passing</span></div>
      <div class="metric ${failedTotal > 0 ? "metric--bad" : ""}"><span class="metric-value">${formatInt(failedTotal)}</span><span class="metric-label">Failing</span></div>
      <div class="metric"><span class="metric-value">${formatInt(stats.skipped)}</span><span class="metric-label">Skipped</span></div>
      <div class="metric"><span class="metric-value">${passRate}</span><span class="metric-label">Pass rate</span></div>
    </div>
  `;
}

function renderMissingDemo() {
  return baseLayout({
    title: "Demo unavailable",
    body: `
      <main class="detail" id="main" style="text-align:center">
        <p class="breadcrumb"><a href="${PAGES_BASE}/"><span aria-hidden="true">&larr;</span><span>Back to dashboard</span></a></p>
        <header class="detail-head">
          <p class="eyebrow"><span class="eyebrow-num">•</span> Build missing</p>
          <h1>SUT build not published</h1>
          <p class="lede">Re-run the Pages workflow to publish the React SUT build.</p>
        </header>
      </main>
    `,
  });
}

// --- Shared helpers --------------------------------------------------------

function baseLayout({ title, body, extraMeta = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="Live dashboard for the qa-automation-lab portfolio — a multi-framework test pyramid covering React + FastAPI." />
    ${extraMeta}
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/svg+xml" href="${PAGES_BASE}/favicon.svg" />
    <meta name="theme-color" content="#0a0a0d" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#f6f7fa" media="(prefers-color-scheme: light)" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap"
      rel="stylesheet"
    />
    <script>
      (function () {
        try {
          var saved = localStorage.getItem("theme");
          var systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
          var theme = saved || (systemLight ? "light" : "dark");
          document.documentElement.setAttribute("data-theme", theme);
        } catch (_) {
          document.documentElement.setAttribute("data-theme", "dark");
        }
      })();
    </script>
    <link rel="stylesheet" href="${PAGES_BASE}/styles.css" />
  </head>
  <body>
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-glow bg-glow--a" aria-hidden="true"></div>
    <div class="bg-glow bg-glow--b" aria-hidden="true"></div>
    <div class="bg-glow bg-glow--c" aria-hidden="true"></div>
    <div class="bg-glow bg-glow--d" aria-hidden="true"></div>

    <a class="skip-link" href="#main">Skip to content</a>

    <nav class="top-nav" aria-label="Site">
      <a class="nav-brand" href="${PAGES_BASE}/">
        <span class="nav-brand-mark" aria-hidden="true">QA</span>
        <span>automation-lab</span>
      </a>
      <div class="nav-links">
        <a class="nav-back" href="https://dwonng.github.io/#work">&larr; Portfolio</a>
        <a href="${PAGES_BASE}/#pyramid">Pyramid</a>
        <a href="${PAGES_BASE}/#defects">Defects</a>
        <a href="${PAGES_BASE}/#sut">SUT</a>
        <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
      <button
        class="nav-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="mobile-menu"
        aria-label="Open navigation menu"
      >
        <span class="nav-toggle__bar"></span>
        <span class="nav-toggle__bar"></span>
        <span class="nav-toggle__bar"></span>
      </button>
    </nav>

    <div class="mobile-menu" id="mobile-menu" aria-hidden="true">
      <a class="nav-back" href="https://dwonng.github.io/#work">&larr; Portfolio</a>
      <a href="${PAGES_BASE}/#pyramid">Pyramid</a>
      <a href="${PAGES_BASE}/#defects">Defects</a>
      <a href="${PAGES_BASE}/#sut">SUT</a>
      <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>

    ${body}

    <button class="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle color theme">
      <svg class="theme-toggle__icon theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg class="theme-toggle__icon theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>

    <script src="${PAGES_BASE}/app.js" defer></script>
    <script src="${PAGES_BASE}/dispatch.js" defer></script>
  </body>
</html>
`;
}

function overallStatus(totals) {
  if (totals.suites_with_data === 0) {
    return { label: "Awaiting first CI run", klass: "idle" };
  }
  if (totals.failures + totals.errors > 0) {
    return { label: "Failing", klass: "bad" };
  }
  return { label: "All suites passing", klass: "ok" };
}

function suiteStatus(stats) {
  const bad = stats.failures + stats.errors;
  if (bad > 0) return { label: `${bad} failing`, klass: "bad" };
  if (stats.tests === 0) return { label: "no tests", klass: "idle" };
  if (stats.skipped > 0 && stats.tests === stats.skipped) {
    return { label: "all skipped", klass: "idle" };
  }
  return { label: "passing", klass: "ok" };
}

function passedCount(stats) {
  return Math.max(
    0,
    stats.tests - stats.failures - stats.errors - stats.skipped,
  );
}

function formatInt(n) {
  return new Intl.NumberFormat("en-US").format(n ?? 0);
}
function formatDuration(sec) {
  if (sec == null) return "—";
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}
function formatPct(rate) {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`;
}
function formatMs(ms) {
  if (ms == null) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}\u00b5s`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function cpRecursiveSync(src, dest) {
  cpSync(src, dest, { recursive: true });
}

// All declarations are in scope now; run main.
await main();
