from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from demo_app.paths import HEALTH_URL, ITEMS_URL, OPENAPI_URL

pytestmark = pytest.mark.integration


class TestHealth:
    def test_returns_ok(self, client: TestClient) -> None:
        response = client.get(HEALTH_URL)
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestOpenApi:
    def test_schema_reachable(self, client: TestClient) -> None:
        response = client.get(OPENAPI_URL)
        assert response.status_code == 200
        body = response.json()
        assert body["openapi"].startswith("3.")
        assert HEALTH_URL in body["paths"]
        assert ITEMS_URL in body["paths"]
