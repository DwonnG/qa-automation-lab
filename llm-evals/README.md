# llm-evals

LLM evaluation layer for `qa-automation-lab`. Adds an AI-specific test suite
alongside the existing pyramid: a traced generator, an LLM-as-judge scorer,
and a CI gate that fails the build on prompt regression or model drift.

Both the generator and the judge call **Anthropic Claude** via the official
Python SDK. Swapping providers (OpenAI, Bedrock, Vertex, LiteLLM, etc.) is
a one-file change to `src/llm_evals/generator.py` and `judge.py`.

## What this layer demonstrates

| Pattern | Where |
|---|---|
| LangSmith tracing | `@traceable` decorators in `src/llm_evals/generator.py` and `src/llm_evals/judge.py`; every call shows up as a run in the LangSmith UI |
| Golden dataset | `datasets/golden_categories.jsonl` |
| Deterministic schema check | `tests/test_item_generation.py::test_generator_output_is_valid_item_schema_offline` |
| LLM-as-judge | `src/llm_evals/judge.py` + `tests/test_item_generation.py::test_live_generation_meets_quality_thresholds` |
| Pass-rate threshold gating | `PASS_RATE_THRESHOLD` and `JUDGE_SCORE_FLOOR` constants drive build pass/fail |
| Model drift detection | Scheduled CI run on Mondays surfaces drift even without a code change |
| Schema reuse from SUT | Eval validates against `demo_app.schemas.ItemCreate` — the same Pydantic model the SUT enforces |

## Layout

```
llm-evals/
├── conftest.py                          # auto-skip live tests, stub OpenAI client fixture
├── datasets/
│   └── golden_categories.jsonl          # 8 categories with quantity bounds
├── prompts/
│   └── generate_item.txt                # single-source prompt under test
├── pyproject.toml                       # uv-managed, Python 3.13
├── src/llm_evals/
│   ├── __init__.py                      # public API
│   ├── generator.py                     # traced LLM call → ItemCandidate
│   └── judge.py                         # LLM-as-judge realism scorer
└── tests/
    └── test_item_generation.py          # offline schema + live judge thresholds
```

## Quick start

```bash
cd llm-evals
uv sync

# Offline run (no secrets needed): exercises stubbed pipeline + schema validation.
uv run pytest -m "not live"

# Live run (requires ANTHROPIC_API_KEY; optional LANGSMITH_API_KEY for tracing).
cp .env.example .env
# ...edit .env, add your keys...
uv run pytest -m live -s
```

## How the eval gate works

For each example in `datasets/golden_categories.jsonl`:

1. `generate_item(category)` calls the configured Anthropic Claude model. The
   call is captured as a `generate_item` run in LangSmith.
2. The output is parsed as JSON and validated against the demo-app's
   `ItemCreate` Pydantic schema. JSON failures and schema failures both
   count as deterministic fails.
3. Valid candidates are forwarded to `judge_realism()`, which calls a second
   model to score realism on a `pass | borderline | fail` scale plus a
   numeric 0.0–1.0 score. This call is captured as a separate `judge_realism`
   run in LangSmith, linked to its parent generation.
4. After every category has been evaluated, the test asserts:
   - schema pass rate ≥ `PASS_RATE_THRESHOLD` (default 0.75)
   - judge pass rate ≥ `PASS_RATE_THRESHOLD`
   - mean realism score ≥ `JUDGE_SCORE_FLOOR` (default 0.5)

A failing gate produces a per-category failure list in the test output, plus
the linked LangSmith traces for full reproduction.

## CI

`.github/workflows/llm-evals.yml` defines two jobs:

- `offline-evals` — runs on every push to `llm-evals/`, no secrets required.
- `live-evals` — runs on `main` pushes and on a Monday cron. Reads
  `ANTHROPIC_API_KEY` and `LANGSMITH_API_KEY` from repo secrets; cleanly
  skips when secrets are absent.

## Cost expectations

The default model is `claude-haiku-4-5`. A full live run is two calls per
dataset row (generator + judge) × 8 rows = 16 calls per run. At current
pricing the cost is well under one US cent per run. New Anthropic accounts
ship with $5 of free credit which covers thousands of runs.

## Why this layer exists

Traditional test pyramids assume deterministic outputs. AI-driven systems
do not. This layer adds the missing pattern: a small, fast, repeatable
eval pipeline that scores non-deterministic LLM output against a curated
reference set, gates the build on quality thresholds, and surfaces drift
over time through scheduled runs and LangSmith dashboards.
