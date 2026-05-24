# Defect catalog

This directory documents the **intentional defects** the test pyramid can detect.
Each defect lives in production code paths, gated by a flag, so:

1. **Tests stay green by default** — flags off, code behaves correctly, every
   suite passes.
2. **A flag flip introduces one specific bug** — the relevant tier of the
   pyramid (and only that tier) starts failing.
3. **The dashboard makes the cause-and-effect visible** — a visitor flips a
   defect on, fires a real CI run, and watches the tier band go red with an
   AI-generated explanation of why.

## How a defect is wired

| Layer | Mechanism |
| --- | --- |
| Backend (FastAPI) | `DEFECTS` env var (CSV of ids). `demo_app/defects.py` exposes `enabled(id)`. Handlers branch inside. |
| Frontend (MSW) | `VITE_DEFECTS` build-time env, or `sessionStorage["qa-automation-lab.defects"]` at runtime. `web/src/lib/defects.ts` exposes `defectEnabled(id)`. MSW handlers branch on it so the in-browser SUT misbehaves identically. |
| CI | `.github/workflows/dispatch-defect-run.yml` accepts a `defects` input, exports both env vars, runs the affected suites, then invokes [`scripts/agent-review.mjs`](../../scripts/agent-review.mjs) to summarize the resulting failures. |

A defect with no flag set is a no-op — production code paths run.

## Pre-seeded example runs

The dashboard's defect panel has an **example run** link on every row
that fetches a pre-baked `agent-feedback.md` + `agent-summary.json` from
[`example-runs/example-<id>/`](example-runs/). These let the panel show
realistic agent output before anyone clicks the live dispatch button.
Regenerate them whenever the defect surface changes — see
[`example-runs/README.md`](example-runs/README.md) for the workflow.

## Catalog

| Id | Tier | Visible in browser? | Caught by |
| --- | --- | --- | --- |
| [`login_accepts_any_pin`](login_accepts_any_pin.md) | Backend unit + UI E2E | Yes | `test_auth.py`, Playwright login |
| [`negative_qty_allowed`](negative_qty_allowed.md) | Backend integration + Contract | No (client validates) | `test_items.py`, Schemathesis |
| [`off_by_one_pagination`](off_by_one_pagination.md) | Backend integration + UI E2E | Yes (one row missing) | `test_items.py` pagination, Playwright count |
| [`delete_skips_auth`](delete_skips_auth.md) | API E2E | No (subtle) | `pytest-api/test_auth_required.py` |
| [`slow_query`](slow_query.md) | Performance (k6) | Yes (slower load) | k6 p95 SLO |

## Adding a new defect

1. Pick a kebab-case id (e.g. `password_logged_in_plaintext`).
2. Author `docs/defects/<id>.md` with the template fields: `id`, `tier`,
   `summary`, `code_path`, `caught_by`, `agent_hint`. The dashboard build
   script parses this markdown to populate the defect chooser UI.
3. Branch the smallest possible code path on `defects.enabled("<id>")`. Keep
   the "off" path exactly as it was before.
4. Add the suite(s) that catch it to the workflow's `defect_to_suites`
   lookup so the dispatch run only spins up the relevant jobs.

## Why this is not a kill switch

Real feature flags gate *unreleased* features so they can be rolled forward
safely. These flags do the opposite: they gate *broken* behavior that should
never reach production. They exist purely as a teaching aid for this lab.
A real deploy pipeline would refuse to ship a build where any of them was on.
