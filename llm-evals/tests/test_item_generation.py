"""Eval suite for the synthetic item generator.

Two flavors:
- offline: schema-validity check using a stub OpenAI client. Always runs.
- live: real LLM call + LLM-as-judge realism scoring. Skipped when
  OPENAI_API_KEY is missing.

The live test enforces a pass-rate threshold across the golden dataset so
the suite fails the build on prompt regression or material model drift.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from llm_evals import generate_item, judge_realism
from llm_evals.judge import Verdict


def _load_item_schema() -> type:
    """Load demo-app's ItemCreate without triggering the FastAPI app import.

    Importing `demo_app.schemas` the normal way pulls in `demo_app.__init__`,
    which boots the FastAPI app and forces the eval suite to take a hard
    dep on FastAPI. Loading schemas.py directly via importlib keeps the
    eval layer lightweight while still sourcing the canonical schema.
    """
    schemas_path = (
        Path(__file__).resolve().parents[2] / "demo-app" / "src" / "demo_app" / "schemas.py"
    )
    spec = importlib.util.spec_from_file_location("demo_app_schemas", schemas_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load schemas from {schemas_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # `from __future__ import annotations` in schemas.py stringifies type
    # hints, so Pydantic needs an explicit rebuild against the module's
    # globals to resolve forward references like `ItemName` and `Quantity`.
    item_create = module.ItemCreate
    item_create.model_rebuild(_types_namespace=vars(module))
    return item_create


ItemCreate = _load_item_schema()

# Tunables. Loosen for new prompts; tighten as the prompt matures.
PASS_RATE_THRESHOLD = 0.75  # fraction of dataset that must earn verdict != FAIL
JUDGE_SCORE_FLOOR = 0.5  # mean realism score must exceed this


def _validate_against_schema(payload: dict[str, Any]) -> tuple[bool, str | None]:
    """Return (is_valid, error_message)."""
    try:
        ItemCreate(**payload)
    except (ValidationError, TypeError) as exc:
        return False, str(exc)
    return True, None


def test_generator_output_is_valid_item_schema_offline(
    stub_anthropic_client: Any,
    golden_dataset: list[dict[str, Any]],
) -> None:
    """Deterministic schema check using the stub client.

    Guards the parsing and validation glue without spending tokens. This
    runs on every CI build, even on forks without secrets.
    """
    sample = golden_dataset[0]
    candidate = generate_item(sample["category"], client=stub_anthropic_client)
    assert candidate.parsed is not None, "stub output should parse as JSON"
    is_valid, err = _validate_against_schema(candidate.parsed)
    assert is_valid, f"stub payload failed Item schema: {err}"


def test_judge_returns_structured_verdict_offline(stub_anthropic_client: Any) -> None:
    """The stub judge always returns 'pass'; verify the data flow is intact."""
    verdict = judge_realism(
        category="office supplies",
        candidate={"name": "Stub Notebook", "quantity": 42},
        client=stub_anthropic_client,
    )
    assert verdict.verdict == Verdict.PASS
    assert 0.0 <= verdict.score <= 1.0


@pytest.mark.live
def test_live_generation_meets_quality_thresholds(
    golden_dataset: list[dict[str, Any]],
) -> None:
    """End-to-end live eval against every golden category.

    Fails the build if:
    - Schema-valid pass rate < PASS_RATE_THRESHOLD, or
    - Mean LLM-as-judge realism score < JUDGE_SCORE_FLOOR.

    Tracing is captured automatically by langsmith when LANGSMITH_TRACING=true
    and LANGSMITH_API_KEY are set in the environment.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set")

    schema_passes = 0
    judge_passes = 0
    judge_scores: list[float] = []
    failures: list[str] = []

    for sample in golden_dataset:
        category = sample["category"]
        candidate = generate_item(category)

        if candidate.parsed is None:
            failures.append(f"[{category}] non-JSON output: {candidate.raw_output!r}")
            continue

        is_valid, err = _validate_against_schema(candidate.parsed)
        if not is_valid:
            failures.append(f"[{category}] schema fail: {err}")
            continue
        schema_passes += 1

        verdict = judge_realism(category=category, candidate=candidate.parsed)
        judge_scores.append(verdict.score)
        if verdict.verdict != Verdict.FAIL:
            judge_passes += 1
        else:
            failures.append(
                f"[{category}] judge failed: {verdict.reason} (candidate={candidate.parsed!r})"
            )

    total = len(golden_dataset)
    schema_rate = schema_passes / total
    judge_rate = judge_passes / total if total else 0.0
    mean_score = sum(judge_scores) / len(judge_scores) if judge_scores else 0.0

    summary = (
        f"schema_pass_rate={schema_rate:.2f} "
        f"judge_pass_rate={judge_rate:.2f} "
        f"mean_realism_score={mean_score:.2f} "
        f"(threshold pass_rate>={PASS_RATE_THRESHOLD}, "
        f"mean_score>={JUDGE_SCORE_FLOOR})"
    )
    print(f"\n[llm-eval] {summary}")

    assert schema_rate >= PASS_RATE_THRESHOLD, (
        f"schema pass rate below threshold: {summary}\nFailures:\n" + "\n".join(failures)
    )
    assert judge_rate >= PASS_RATE_THRESHOLD, (
        f"judge pass rate below threshold: {summary}\nFailures:\n" + "\n".join(failures)
    )
    assert mean_score >= JUDGE_SCORE_FLOOR, f"mean realism score below floor: {summary}"
