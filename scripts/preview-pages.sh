#!/usr/bin/env bash
# Build the GitHub Pages dashboard with whichever artifacts you have locally
# (running the fast suites on the fly), and serve it at the same base path
# GitHub Pages will use, so all relative links resolve identically.
#
# Usage:
#   scripts/preview-pages.sh                  # run fast suites, build, serve
#   scripts/preview-pages.sh --no-tests       # use existing artifacts only
#   scripts/preview-pages.sh --build-only     # build without serving
#   PORT=4321 scripts/preview-pages.sh        # use a different port (default 8765)
#
# Requirements:
#   - Node 22+, pnpm, uv installed
#   - Python 3 on PATH (for the static server)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8765}"
PAGES_BASE="/qa-automation-lab"
RUN_TESTS=1
SERVE=1
for arg in "$@"; do
  case "$arg" in
    --no-tests) RUN_TESTS=0 ;;
    --build-only) SERVE=0 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1) Run the fast suites locally (everything that doesn't need a live server).
# ---------------------------------------------------------------------------

if [ "$RUN_TESTS" -eq 1 ]; then
  if command -v uv >/dev/null 2>&1; then
    log "Running demo-app pytest"
    (cd demo-app && uv sync --quiet && uv run pytest --quiet --junitxml=report.xml >/dev/null) \
      || warn "demo-app tests failed; the dashboard will still show whatever results were emitted"
  else
    warn "uv not installed; skipping backend tests"
  fi

  if command -v pnpm >/dev/null 2>&1; then
    log "Running web vitest"
    (cd web && pnpm install --silent --frozen-lockfile >/dev/null 2>&1 || pnpm install --silent >/dev/null)
    (cd web && pnpm test:ci >/dev/null 2>&1) \
      || warn "web tests failed; the dashboard will still show whatever results were emitted"
    log "Building web demo (MSW mode, Pages base)"
    (cd web && VITE_BASE="${PAGES_BASE}/demo/" VITE_USE_MOCKS=true pnpm build >/dev/null)
  else
    warn "pnpm not installed; skipping web tests and demo build"
  fi
fi

# ---------------------------------------------------------------------------
# 2) Stage everything we have into _artifacts/ (mirror of CI artifact layout).
# ---------------------------------------------------------------------------

log "Staging artifacts into _artifacts/"
rm -rf _artifacts
mkdir -p _artifacts/{demo-app-reports,web-coverage,web-junit,k6-summary,ci-meta}

stage() {
  # stage <src> <dest> - copy if src exists, else noop.
  if [ -e "$1" ]; then
    cp -R "$1" "$2"
  fi
}

stage demo-app/report.xml   _artifacts/demo-app-reports/
stage demo-app/coverage.xml _artifacts/demo-app-reports/
stage demo-app/htmlcov      _artifacts/demo-app-reports/htmlcov
stage web/junit.xml         _artifacts/web-junit/
if [ -d web/coverage ]; then
  cp -R web/coverage/. _artifacts/web-coverage/
fi
stage perf/summary.json     _artifacts/k6-summary/

# Synthetic minimal data for suites we can't easily run locally, so the cards
# show *something* in preview mode. Override by dropping real artifacts into
# _artifacts/<name>/ before running this script with --no-tests.
mkdir -p _artifacts/pytest-api-report _artifacts/schemathesis-report \
  _artifacts/playwright-report _artifacts/cypress-artifacts/results

if [ ! -f _artifacts/pytest-api-report/report.xml ]; then
  cat > _artifacts/pytest-api-report/report.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="local-preview" tests="0" failures="0" errors="0" skipped="0" time="0"/></testsuites>
XML
fi
if [ ! -f _artifacts/schemathesis-report/report.xml ]; then
  cp _artifacts/pytest-api-report/report.xml _artifacts/schemathesis-report/report.xml
fi
if [ ! -f _artifacts/playwright-report/results.xml ]; then
  cp _artifacts/pytest-api-report/report.xml _artifacts/playwright-report/results.xml
fi
if ! ls _artifacts/cypress-artifacts/results/*.xml >/dev/null 2>&1; then
  cp _artifacts/pytest-api-report/report.xml _artifacts/cypress-artifacts/results/junit-local.xml
fi

# Fake CI metadata so the status bar shows something readable in preview.
cat > _artifacts/ci-meta/meta.json <<JSON
{
  "sha": "local-preview",
  "short_sha": "local",
  "ref": "preview",
  "run_id": "0",
  "run_url": "",
  "triggered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

# ---------------------------------------------------------------------------
# 3) Build the dashboard.
# ---------------------------------------------------------------------------

log "Building dashboard into _site/"
PAGES_BASE="$PAGES_BASE" node scripts/build-pages-dashboard.mjs \
  --artifacts-dir _artifacts \
  --web-dist web/dist \
  --pages-dir pages \
  --out _site

# ---------------------------------------------------------------------------
# 4) Serve at the same base path GitHub Pages uses, so relative links work.
# ---------------------------------------------------------------------------

if [ "$SERVE" -eq 0 ]; then
  log "Build done. Skipping server (--build-only)."
  exit 0
fi

rm -rf _site_serve
mkdir -p "_site_serve${PAGES_BASE}"
cp -R _site/. "_site_serve${PAGES_BASE}/"

URL="http://localhost:${PORT}${PAGES_BASE}/"
log "Serving at ${URL}"
log "Press Ctrl+C to stop."

if command -v open >/dev/null 2>&1; then
  ( sleep 1 && open "$URL" ) &
fi

exec python3 -m http.server "$PORT" --directory _site_serve
