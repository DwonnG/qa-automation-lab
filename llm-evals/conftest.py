"""Shared fixtures for the LLM eval suite.

We split tests into two flavors:
- offline tests: run on every CI build with a stubbed Anthropic client.
- live tests (marker: live): hit a real Anthropic endpoint and only run when
  ANTHROPIC_API_KEY is present. They are auto-skipped otherwise so the suite
  stays green for forks and PRs that don't carry secrets.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from dotenv import load_dotenv

_DATASET_PATH = Path(__file__).resolve().parent / "datasets" / "golden_categories.jsonl"


def pytest_configure(config: pytest.Config) -> None:
    """Auto-load .env so local runs don't need manual exporting."""
    load_dotenv()


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip live-marked tests when ANTHROPIC_API_KEY is missing."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    skip_live = pytest.mark.skip(reason="ANTHROPIC_API_KEY not set; skipping live LLM evals")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)


@pytest.fixture(scope="session")
def golden_dataset() -> list[dict[str, Any]]:
    """Load every golden example into a list of dicts."""
    with _DATASET_PATH.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


@pytest.fixture
def stub_anthropic_client() -> Iterator[Any]:
    """Tiny stand-in client for offline tests; returns canned Anthropic-shaped responses."""

    def _response(text: str) -> SimpleNamespace:
        # Mirror anthropic.types.Message: .content is a list of objects with .text.
        return SimpleNamespace(content=[SimpleNamespace(text=text)])

    class _StubMessages:
        def create(self, **kwargs: Any) -> SimpleNamespace:
            # The judge call sets a `system=` arg; the generator call does not.
            if kwargs.get("system"):
                return _response(json.dumps({"verdict": "pass", "score": 0.9, "reason": "stub"}))
            return _response(json.dumps({"name": "Stub Notebook", "quantity": 42}))

    class _StubClient:
        messages = _StubMessages()

    yield _StubClient()
