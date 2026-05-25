"""LLM-as-judge: a second model scores how realistic a generated item is.

The judge is intentionally narrow. It returns a small enum and a numeric
score so downstream eval suites can aggregate, threshold, and track drift
over time. The judge call is itself traced in LangSmith so the full
generator -> judge chain is visible per run.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from anthropic import Anthropic
from langsmith import traceable

_DEFAULT_JUDGE_MODEL = "claude-haiku-4-5"
_MAX_TOKENS = 256

_JUDGE_SYSTEM = (
    "You are a strict quality judge for synthetic e-commerce inventory data. "
    "You score one candidate item against the category it was generated for. "
    "Always reply in strict JSON only, with no markdown fences and no prose. "
    'Shape: {"verdict": "pass" | "borderline" | "fail", '
    '"score": number between 0.0 and 1.0, '
    '"reason": "<one sentence>"}.'
)

_JUDGE_USER_TEMPLATE = (
    "Category: {category}\n"
    "Candidate: {candidate_json}\n\n"
    "Rate realism. A 'pass' item reads like a plausible product a small shop "
    "in this category would stock. A 'fail' item is generic, nonsensical, "
    "or off-category. Borderline is anything in between."
)


class Verdict(StrEnum):
    PASS = "pass"  # noqa: S105 -- enum verdict, not a credential
    BORDERLINE = "borderline"
    FAIL = "fail"


@dataclass(frozen=True)
class RealismVerdict:
    verdict: Verdict
    score: float
    reason: str
    judge_model: str


def _extract_text(response: Any) -> str:
    """Pull the first text block out of an Anthropic Messages response."""
    blocks = getattr(response, "content", None) or []
    for block in blocks:
        text = getattr(block, "text", None)
        if text is not None:
            return text
        if isinstance(block, dict) and "text" in block:
            return str(block["text"])
    return ""


def _strip_json_fences(text: str) -> str:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else ""
    if candidate.endswith("```"):
        candidate = candidate.rsplit("```", 1)[0]
    return candidate.strip()


@traceable(name="judge_realism", run_type="llm")
def judge_realism(
    *,
    category: str,
    candidate: dict[str, object],
    model: str = _DEFAULT_JUDGE_MODEL,
    client: Anthropic | None = None,
) -> RealismVerdict:
    """Score one candidate item for realism within its category."""

    if client is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set; pass a client= for offline tests "
                "or export the key before running live evals."
            )
        client = Anthropic()

    response = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        temperature=0.0,
        system=_JUDGE_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": _JUDGE_USER_TEMPLATE.format(
                    category=category,
                    candidate_json=json.dumps(candidate, ensure_ascii=False),
                ),
            },
        ],
    )

    raw = _strip_json_fences(_extract_text(response))
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {}

    verdict_raw = str(payload.get("verdict", "fail")).lower()
    try:
        verdict = Verdict(verdict_raw)
    except ValueError:
        verdict = Verdict.FAIL

    score_raw = payload.get("score", 0.0)
    try:
        score = float(score_raw)
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(1.0, score))

    return RealismVerdict(
        verdict=verdict,
        score=score,
        reason=str(payload.get("reason", "")),
        judge_model=model,
    )
