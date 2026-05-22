from __future__ import annotations

import pytest
from faker import Faker

from demo_app.store import ItemNotFoundError, ItemStore

pytestmark = pytest.mark.unit

fake = Faker()


class TestItemStoreCreate:
    def test_create_returns_item_with_unique_id(self, store: ItemStore) -> None:
        a = store.create(name=fake.word(), quantity=1)
        b = store.create(name=fake.word(), quantity=2)
        assert a.id != b.id

    def test_create_assigns_provided_fields(self, store: ItemStore) -> None:
        item = store.create(name="apples", quantity=7)
        assert item.name == "apples"
        assert item.quantity == 7


class TestItemStoreRead:
    def test_get_returns_existing_item(self, store: ItemStore) -> None:
        created = store.create(name=fake.word(), quantity=3)
        assert store.get(created.id) is store.get(created.id)

    def test_get_missing_id_raises_not_found(self, store: ItemStore) -> None:
        with pytest.raises(ItemNotFoundError):
            store.get("nope")

    def test_list_returns_independent_copy(self, store: ItemStore) -> None:
        store.create(name=fake.word(), quantity=1)
        snapshot = store.list()
        store.create(name=fake.word(), quantity=2)
        assert len(snapshot) == 1


class TestItemStoreUpdate:
    def test_update_changes_only_provided_fields(self, store: ItemStore) -> None:
        item = store.create(name="x", quantity=1)
        updated = store.update(item.id, name="y")
        assert updated.name == "y"
        assert updated.quantity == 1

    def test_update_missing_id_raises_not_found(self, store: ItemStore) -> None:
        with pytest.raises(ItemNotFoundError):
            store.update("nope", name="x")


class TestItemStoreDelete:
    def test_delete_removes_item(self, store: ItemStore) -> None:
        item = store.create(name=fake.word(), quantity=1)
        store.delete(item.id)
        with pytest.raises(ItemNotFoundError):
            store.get(item.id)

    def test_delete_missing_id_raises_not_found(self, store: ItemStore) -> None:
        with pytest.raises(ItemNotFoundError):
            store.delete("nope")


class TestItemStoreReset:
    def test_reset_clears_all_items(self, store: ItemStore) -> None:
        for _ in range(3):
            store.create(name=fake.word(), quantity=1)
        store.reset()
        assert store.list() == []
