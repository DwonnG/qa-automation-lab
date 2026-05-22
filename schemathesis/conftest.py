from __future__ import annotations

import os
import time

import httpx
import pytest

from helpers.paths import HEALTH_URL

DEFAULT_BASE_URL = os.environ.get("BASE_URL", "http://localhost:5050")


@pytest.fixture(scope="session")
def base_url() -> str:
    return DEFAULT_BASE_URL


@pytest.fixture(scope="session", autouse=True)
def _wait_for_server(base_url: str) -> None:
    deadline = time.monotonic() + 30.0
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}{HEALTH_URL}", timeout=2.0)
            if response.status_code == 200:
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"server not reachable at {base_url}: {last_error}")
