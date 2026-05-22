from __future__ import annotations

import httpx
import pytest

from helpers.api_client import ItemsApiClient
from helpers.assertions import _assert_error_response
from helpers.paths import ITEMS_URL, item_url

_SAMPLE_ITEM_URL = item_url("some-id")

_PROTECTED_ROUTES = [
    ("GET", ITEMS_URL),
    ("POST", ITEMS_URL),
    ("GET", _SAMPLE_ITEM_URL),
    ("PUT", _SAMPLE_ITEM_URL),
    ("DELETE", _SAMPLE_ITEM_URL),
]
_PROTECTED_ROUTE_IDS = ["list", "create", "get", "update", "delete"]


@pytest.mark.regression
class TestUnauthenticatedAccess:
    @pytest.mark.parametrize(
        ("method", "path"),
        _PROTECTED_ROUTES,
        ids=_PROTECTED_ROUTE_IDS,
    )
    def test_missing_bearer_returns_401(
        self,
        base_url: str,
        method: str,
        path: str,
    ) -> None:
        response = httpx.request(method, f"{base_url}{path}")
        assert response.status_code == 401
        _assert_error_response(response.json())

    def test_invalid_bearer_returns_401(self, base_url: str) -> None:
        response = httpx.get(
            f"{base_url}{ITEMS_URL}",
            headers={"Authorization": "Bearer not-real"},
        )
        assert response.status_code == 401


@pytest.mark.regression
class TestPayloadValidation:
    @pytest.mark.parametrize(
        ("payload",),
        [
            ({"name": "", "quantity": 1},),
            ({"name": "x", "quantity": -1},),
            ({"name": "x"},),
            ({"quantity": 1},),
            ({"name": "x", "quantity": 1, "extra": "y"},),
        ],
        ids=[
            "empty_name",
            "negative_quantity",
            "missing_quantity",
            "missing_name",
            "extra_field",
        ],
    )
    def test_create_rejects_invalid_body(
        self,
        items_client: ItemsApiClient,
        payload: dict,
    ) -> None:
        response = items_client._request("POST", items_client.resource_path, json=payload)
        assert response.status_code == 422


@pytest.mark.regression
class TestNotFoundBehavior:
    def test_get_missing_returns_404(self, items_client: ItemsApiClient) -> None:
        response = items_client.get("does-not-exist")
        assert response.status_code == 404
        _assert_error_response(response.json(), detail="item not found")

    def test_update_missing_returns_404(self, items_client: ItemsApiClient) -> None:
        response = items_client.update("does-not-exist", name="x")
        assert response.status_code == 404

    def test_delete_missing_returns_404(self, items_client: ItemsApiClient) -> None:
        response = items_client.delete("does-not-exist")
        assert response.status_code == 404
