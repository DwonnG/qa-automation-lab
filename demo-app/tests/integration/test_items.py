from __future__ import annotations

import pytest
from faker import Faker
from fastapi.testclient import TestClient

from demo_app.paths import ITEMS_URL, item_url

pytestmark = pytest.mark.integration

fake = Faker()


def _assert_item_shape(payload: dict) -> None:
    assert set(payload) == {"id", "name", "quantity"}
    assert isinstance(payload["id"], str)
    assert isinstance(payload["name"], str)
    assert isinstance(payload["quantity"], int)


class TestItemsCreate:
    def test_create_returns_201_and_item(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.post(
            ITEMS_URL,
            json={"name": "apples", "quantity": 5},
            headers=auth_headers,
        )
        assert response.status_code == 201
        body = response.json()
        _assert_item_shape(body)
        assert body["name"] == "apples"
        assert body["quantity"] == 5

    def test_create_without_auth_returns_401(self, client: TestClient) -> None:
        response = client.post(ITEMS_URL, json={"name": "x", "quantity": 1})
        assert response.status_code == 401

    @pytest.mark.parametrize(
        ("payload",),
        [
            ({"name": "", "quantity": 1},),
            ({"name": "x", "quantity": -1},),
            ({"name": "x"},),
            ({"quantity": 1},),
        ],
        ids=["empty_name", "negative_quantity", "missing_quantity", "missing_name"],
    )
    def test_create_invalid_body_returns_422(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        payload: dict,
    ) -> None:
        response = client.post(ITEMS_URL, json=payload, headers=auth_headers)
        assert response.status_code == 422


class TestItemsRead:
    def test_list_starts_empty(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.get(ITEMS_URL, headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_list_reflects_created_items(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        for name in ("a", "b", "c"):
            client.post(
                ITEMS_URL,
                json={"name": name, "quantity": 1},
                headers=auth_headers,
            )
        response = client.get(ITEMS_URL, headers=auth_headers)
        assert response.status_code == 200
        assert {i["name"] for i in response.json()} == {"a", "b", "c"}

    def test_get_missing_returns_404(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.get(item_url("does-not-exist"), headers=auth_headers)
        assert response.status_code == 404


class TestItemsUpdate:
    def test_update_modifies_fields(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        created = client.post(
            ITEMS_URL,
            json={"name": "old", "quantity": 1},
            headers=auth_headers,
        ).json()
        response = client.put(
            item_url(created["id"]),
            json={"name": "new"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "new"
        assert body["quantity"] == 1

    def test_update_missing_returns_404(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.put(
            item_url("nope"),
            json={"name": "x"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestItemsDelete:
    def test_delete_returns_204(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        created = client.post(
            ITEMS_URL,
            json={"name": fake.word(), "quantity": 1},
            headers=auth_headers,
        ).json()
        response = client.delete(item_url(created["id"]), headers=auth_headers)
        assert response.status_code == 204

        follow_up = client.get(item_url(created["id"]), headers=auth_headers)
        assert follow_up.status_code == 404

    def test_delete_missing_returns_404(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = client.delete(item_url("nope"), headers=auth_headers)
        assert response.status_code == 404
