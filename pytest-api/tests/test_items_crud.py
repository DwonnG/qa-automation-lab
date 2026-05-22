from __future__ import annotations

import pytest
from faker import Faker

from helpers.api_client import ItemsApiClient
from helpers.assertions import _assert_item_shape


@pytest.mark.smoke
class TestItemsLifecycle:
    def test_full_crud_round_trip(self, items_client: ItemsApiClient, faker: Faker) -> None:
        create_response = items_client.create(name=faker.unique.word(), quantity=3)
        assert create_response.status_code == 201
        created = create_response.json()
        _assert_item_shape(created)

        get_response = items_client.get(created["id"])
        assert get_response.status_code == 200
        assert get_response.json() == created

        new_name = faker.unique.word()
        update_response = items_client.update(created["id"], name=new_name, quantity=9)
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["name"] == new_name
        assert updated["quantity"] == 9

        list_response = items_client.list()
        assert list_response.status_code == 200
        assert any(item["id"] == created["id"] for item in list_response.json())

        delete_response = items_client.delete(created["id"])
        assert delete_response.status_code == 204

        missing_response = items_client.get(created["id"])
        assert missing_response.status_code == 404


@pytest.mark.regression
class TestItemsList:
    def test_list_returns_array(self, items_client: ItemsApiClient) -> None:
        response = items_client.list()
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_created_item_appears_in_list(
        self,
        items_client: ItemsApiClient,
        created_item: dict,
    ) -> None:
        response = items_client.list()
        ids = [item["id"] for item in response.json()]
        assert created_item["id"] in ids
