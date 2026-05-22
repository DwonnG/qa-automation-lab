from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from demo_app.paths import ITEMS_URL, item_url

pytestmark = pytest.mark.integration

_SAMPLE_ITEM_URL = item_url("some-id")

_PROTECTED_ROUTES = [
    ("GET", ITEMS_URL),
    ("POST", ITEMS_URL),
    ("GET", _SAMPLE_ITEM_URL),
    ("PUT", _SAMPLE_ITEM_URL),
    ("DELETE", _SAMPLE_ITEM_URL),
]
_PROTECTED_ROUTE_IDS = ["list_items", "create_item", "get_item", "update_item", "delete_item"]


class TestUnauthenticatedAccess:
    @pytest.mark.parametrize(
        ("method", "path"),
        _PROTECTED_ROUTES,
        ids=_PROTECTED_ROUTE_IDS,
    )
    def test_missing_bearer_returns_401(
        self,
        client: TestClient,
        method: str,
        path: str,
    ) -> None:
        response = client.request(method, path, json={})
        assert response.status_code == 401

    def test_invalid_bearer_returns_401(self, client: TestClient) -> None:
        response = client.get(
            ITEMS_URL,
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert response.status_code == 401

    def test_wrong_scheme_returns_401(self, client: TestClient) -> None:
        response = client.get(
            ITEMS_URL,
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
        )
        assert response.status_code == 401


class TestValidationErrorShape:
    def test_unknown_field_rejected(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.post(
            ITEMS_URL,
            json={"name": "x", "quantity": 1, "rogue": True},
            headers=auth_headers,
        )
        assert response.status_code == 422
        assert "detail" in response.json()
