from __future__ import annotations

import httpx
import pytest

from helpers.paths import HEALTH_URL, OPENAPI_URL


@pytest.mark.smoke
class TestHealthEndpoint:
    def test_health_returns_ok(self, base_url: str) -> None:
        response = httpx.get(f"{base_url}{HEALTH_URL}")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_openapi_schema_reachable(self, base_url: str) -> None:
        response = httpx.get(f"{base_url}{OPENAPI_URL}")
        assert response.status_code == 200
        body = response.json()
        assert body["openapi"].startswith("3.")
