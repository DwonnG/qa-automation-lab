"""LLM-based item generator instrumented with LangSmith tracing.

The single public function `generate_item` calls Anthropic Claude with the
prompt defined in `prompts/generate_item.txt`, returning an `ItemCandidate`
that holds both the raw output and the parsed payload (when parseable).

The `@traceable` decorator from langsmith captures every call as a run in
the LangSmith UI when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are
set. When they are not set, the decorator is a no-op so the function still
works locally without LangSmith.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from langsmith import traceable

_PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "generate_item.txt"
_DEFAULT_MODEL = "claude-haiku-4-5"
_MAX_TOKENS = 256


def _load_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


@dataclass(frozen=True)
class ItemCandidate:
    """Raw and parsed forms of a single LLM-generated item.

    `parsed` is None when the model returned non-JSON or invalid JSON;
    callers should treat that as a deterministic schema failure rather
    than a model-content failure.
    """

    category: str
    raw_output: str
    parsed: dict[str, object] | None
    model: str


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
    """Tolerate models that wrap JSON in markdown fences despite instructions."""
    candidate = text.strip()
    if candidate.startswith("```"):
        # remove leading fence with optional language tag
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else ""
    if candidate.endswith("```"):
        candidate = candidate.rsplit("```", 1)[0]
    return candidate.strip()


@traceable(name="generate_item", run_type="llm")
def generate_item(
    category: str,
    *,
    model: str = _DEFAULT_MODEL,
    client: Anthropic | None = None,
) -> ItemCandidate:
    """Generate one synthetic Item payload for the given category.

    Args:
        category: Free-text category (e.g. "office supplies").
        model: Anthropic model id. Defaults to a low-cost model suitable for evals.
        client: Optional pre-built client. Useful for tests that inject a fake.

    Returns:
        ItemCandidate with the raw model output and (best-effort) parsed JSON.

    Raises:
        RuntimeError: if ANTHROPIC_API_KEY is unset and no client was provided.
    """

    if client is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set; pass a client= for offline tests "
                "or export the key before running live evals."
            )
        client = Anthropic()

    prompt = _load_prompt().format(category=category)
    response = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        temperature=0.7,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = _strip_json_fences(_extract_text(response))

    parsed: dict[str, object] | None
    try:
        candidate = json.loads(raw)
        parsed = candidate if isinstance(candidate, dict) else None
    except json.JSONDecodeError:
        parsed = None

    return ItemCandidate(category=category, raw_output=raw, parsed=parsed, model=model)
