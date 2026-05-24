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
const OUT = resolve(args.out ?? join(ROOT, "_site"));
const PAGES_BASE = (env.PAGES_BASE ?? "/qa-automation-lab").replace(/\/$/, "");

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
    title: "Contract (property-based)",
    layer: "Contract",
    tools: "Schemathesis 4",
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
    title: "Performance (k6)",
    layer: "Performance",
    tools: "k6",
    artifact: "k6-summary",
    junit: null,
    htmlReport: null,
    detailMode: "k6",
    sourceHref: `${REPO_URL}/tree/main/perf`,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

await main();

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

  writeFileSync(
    join(OUT, "index.html"),
    renderDashboard(dashboard, suiteResults),
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

function renderDashboard(data, suiteResults) {
  const { totals, ci } = data;
  const updated = new Date(data.generated_at);
  const overall = overallStatus(totals);
  return baseLayout({
    title: "qa-automation-lab dashboard",
    body: `
      <header class="hero">
        <div class="hero-inner">
          <div class="hero-intro">
            ${renderStatusBadge(overall, totals, ci, updated)}
          </div>
          <h1 class="hero-title">qa-automation-lab</h1>
          <p class="hero-lead">
            A self-contained, multi-framework test automation lab demonstrating
            a <strong>full test pyramid</strong> plus cross-cutting contract,
            accessibility, and performance coverage against one bundled React
            + FastAPI <a href="#sut">system under test</a>.
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
        <section class="section" id="suites">
          <div class="section-head">
            <p class="eyebrow"><span class="eyebrow-num">01</span> Coverage</p>
            <h2>Suites in the pyramid</h2>
            <p class="section-desc">
              Counts come from JUnit XML or the k6 summary uploaded by the
              latest successful CI run on <code>main</code>. Tap a card to
              drill into its full report.
            </p>
          </div>
          <div class="suite-grid">
            ${suiteResults.map(renderSuiteCard).join("\n")}
          </div>
        </section>

        <section class="section" id="shape">
          <div class="section-head">
            <p class="eyebrow"><span class="eyebrow-num">02</span> Architecture</p>
            <h2>How the lab is shaped</h2>
            <p class="section-desc">
              Five core layers validating correctness from pure-logic unit tests
              up to UI E2E, plus three cross-cutting layers for compliance and
              capacity &mdash; all targeting one bundled app so the whole
              pyramid runs offline.
            </p>
          </div>
          ${renderShapeSection()}
        </section>

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

function renderSuiteCard(suite) {
  if (suite.key === "perf") return renderPerfCard(suite);
  if (!suite.available || !suite.stats) {
    return `
      <a class="suite-card suite-card--idle" href="${suite.detailUrl}">
        <div class="suite-card-head">
          <span class="layer-pill">${escapeHtml(suite.layer)}</span>
          <span class="status-chip status-chip--idle">no data yet</span>
        </div>
        <h3>${escapeHtml(suite.title)}</h3>
        <p class="suite-tools">${escapeHtml(suite.tools)}</p>
        <p class="suite-empty">Run the workflow on <code>main</code> to populate this card.</p>
        <p class="suite-cta">Open details <span class="arrow">&rarr;</span></p>
      </a>
    `;
  }
  const status = suiteStatus(suite.stats);
  const passed = passedCount(suite.stats);
  const failedTotal = suite.stats.failures + suite.stats.errors;
  return `
    <a class="suite-card suite-card--${status.klass}" href="${suite.detailUrl}">
      <div class="suite-card-head">
        <span class="layer-pill">${escapeHtml(suite.layer)}</span>
        <span class="status-chip status-chip--${status.klass}">${status.label}</span>
      </div>
      <h3>${escapeHtml(suite.title)}</h3>
      <p class="suite-tools">${escapeHtml(suite.tools)}</p>
      <div class="suite-stats">
        <div><span class="num">${formatInt(suite.stats.tests)}</span><span>tests</span></div>
        <div class="ok"><span class="num">${formatInt(passed)}</span><span>passing</span></div>
        <div class="${failedTotal > 0 ? "bad" : ""}"><span class="num">${formatInt(failedTotal)}</span><span>failing</span></div>
        <div><span class="num">${formatInt(suite.stats.skipped)}</span><span>skipped</span></div>
        <div><span class="num">${formatDuration(suite.stats.time)}</span><span>duration</span></div>
        <div><span class="num">${suite.stats.tests > 0 ? `${Math.round((passed / Math.max(1, suite.stats.tests - suite.stats.skipped)) * 100)}%` : "—"}</span><span>pass rate</span></div>
      </div>
      <p class="suite-cta">Open report <span class="arrow">&rarr;</span></p>
    </a>
  `;
}

function renderPerfCard(suite) {
  if (!suite.available || !suite.perf) {
    return `
      <a class="suite-card suite-card--idle" href="${suite.detailUrl}">
        <div class="suite-card-head">
          <span class="layer-pill">${escapeHtml(suite.layer)}</span>
          <span class="status-chip status-chip--idle">no data yet</span>
        </div>
        <h3>${escapeHtml(suite.title)}</h3>
        <p class="suite-tools">${escapeHtml(suite.tools)}</p>
        <p class="suite-empty">Perf workflow hasn&rsquo;t uploaded a summary yet.</p>
        <p class="suite-cta">Open details <span class="arrow">&rarr;</span></p>
      </a>
    `;
  }
  const p = suite.perf;
  const klass = p.thresholds_passed ? "ok" : "bad";
  const label = p.thresholds_passed ? "thresholds OK" : "thresholds violated";
  return `
    <a class="suite-card suite-card--${klass}" href="${suite.detailUrl}">
      <div class="suite-card-head">
        <span class="layer-pill">${escapeHtml(suite.layer)}</span>
        <span class="status-chip status-chip--${klass}">${label}</span>
      </div>
      <h3>${escapeHtml(suite.title)}</h3>
      <p class="suite-tools">${escapeHtml(suite.tools)}</p>
      <div class="suite-stats">
        <div><span class="num">${formatInt(p.request_count ?? 0)}</span><span>requests</span></div>
        <div class="${p.failed_rate > 0 ? "bad" : "ok"}"><span class="num">${formatPct(p.failed_rate)}</span><span>error rate</span></div>
        <div><span class="num">${formatMs(p.avg_ms)}</span><span>avg</span></div>
        <div><span class="num">${formatMs(p.p95_ms)}</span><span>p95</span></div>
        <div><span class="num">${formatMs(p.p99_ms)}</span><span>p99</span></div>
        <div><span class="num">${formatMs(p.max_ms)}</span><span>max</span></div>
      </div>
      <p class="suite-cta">Open report <span class="arrow">&rarr;</span></p>
    </a>
  `;
}

function renderShapeSection() {
  return `
    <div class="shape-grid">
      <div class="shape-card">
        <h3>Five core layers, three cross-cutting</h3>
        <p>
          Most test-automation portfolios show one framework against a
          synthetic API. This repo shows how a staff-level SDET thinks across
          the whole pyramid &mdash; five test layers validating correctness
          from pure-logic unit tests up to UI E2E, plus three cross-cutting
          layers for compliance and capacity.
        </p>
        <p>
          Each framework is used in its own idiom: POM in Playwright, app
          actions in Cypress, abstract clients in pytest, MSW for the
          component layer &mdash; all targeting one bundled FastAPI + React
          app so the whole pyramid runs offline.
        </p>
      </div>
      <figure class="shape-pyramid" aria-label="Test pyramid for qa-automation-lab">
        ${renderPyramidSvg()}
      </figure>
    </div>
  `;
}

function renderPyramidSvg() {
  // Same SVG language as the portfolio's hero pyramid — slate→wine
  // glossy gradients with a strong upper highlight and a deep lower
  // shadow so the slices read as 3D rather than flat bands. Five core
  // tiers (UI, API, Component, Integration, Unit) matching the lab.
  return `
    <svg
      class="pyramid-svg"
      viewBox="0 0 240 240"
      role="img"
      aria-label="Test pyramid: UI, API, Component, Integration, Unit"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="lab-grad-ui" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(200,210,235,0.95)" />
          <stop offset="40%" stop-color="rgba(106,115,146,0.88)" />
          <stop offset="100%" stop-color="rgba(50,55,75,0.65)" />
        </linearGradient>
        <linearGradient id="lab-grad-api" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(170,172,212,0.95)" />
          <stop offset="40%" stop-color="rgba(78,79,115,0.88)" />
          <stop offset="100%" stop-color="rgba(40,42,68,0.66)" />
        </linearGradient>
        <linearGradient id="lab-grad-component" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(185,140,180,0.94)" />
          <stop offset="40%" stop-color="rgba(90,53,88,0.9)" />
          <stop offset="100%" stop-color="rgba(48,22,46,0.7)" />
        </linearGradient>
        <linearGradient id="lab-grad-integration" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(175,120,150,0.95)" />
          <stop offset="40%" stop-color="rgba(82,42,67,0.92)" />
          <stop offset="100%" stop-color="rgba(40,16,32,0.74)" />
        </linearGradient>
        <linearGradient id="lab-grad-unit" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(165,105,125,0.96)" />
          <stop offset="40%" stop-color="rgba(74,31,45,0.95)" />
          <stop offset="100%" stop-color="rgba(35,10,18,0.78)" />
        </linearGradient>
      </defs>
      <g class="pyramid-slices">
        <path class="pyramid-slice" d="M 122.15 18.51 L 137.85 51.49 Q 140 56 135 56 L 105 56 Q 100 56 102.15 51.49 L 117.85 18.51 Q 120 14 122.15 18.51 Z" fill="url(#lab-grad-ui)" />
        <path class="pyramid-slice" d="M 105 56 L 135 56 Q 140 56 142.15 60.51 L 157.85 93.49 Q 160 98 155 98 L 85 98 Q 80 98 82.15 93.49 L 97.85 60.51 Q 100 56 105 56 Z" fill="url(#lab-grad-api)" />
        <path class="pyramid-slice" d="M 85 98 L 155 98 Q 160 98 162.15 102.51 L 177.85 135.49 Q 180 140 175 140 L 65 140 Q 60 140 62.15 135.49 L 77.85 102.51 Q 80 98 85 98 Z" fill="url(#lab-grad-component)" />
        <path class="pyramid-slice" d="M 65 140 L 175 140 Q 180 140 182.15 144.51 L 197.85 177.49 Q 200 182 195 182 L 45 182 Q 40 182 42.15 177.49 L 57.85 144.51 Q 60 140 65 140 Z" fill="url(#lab-grad-integration)" />
        <path class="pyramid-slice" d="M 45 182 L 195 182 Q 200 182 202.15 186.51 L 217.85 219.49 Q 220 224 215 224 L 25 224 Q 20 224 22.15 219.49 L 37.85 186.51 Q 40 182 45 182 Z" fill="url(#lab-grad-unit)" />
      </g>
      <g class="pyramid-slice-labels">
        <text x="120" y="46">UI</text>
        <text x="120" y="80">API</text>
        <text x="120" y="123">Component</text>
        <text x="120" y="165">Integration</text>
        <text x="120" y="207">Unit</text>
      </g>
    </svg>
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

function baseLayout({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="Live dashboard for the qa-automation-lab portfolio — a multi-framework test pyramid covering React + FastAPI." />
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
        <a href="${PAGES_BASE}/#suites">Suites</a>
        <a href="${PAGES_BASE}/#shape">Architecture</a>
        <a href="${PAGES_BASE}/#sut">SUT</a>
        <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </nav>

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
