from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from uuid import uuid4


class ItemNotFoundError(KeyError):
    pass


@dataclass
class Item:
    id: str
    name: str
    quantity: int


@dataclass
class ItemStore:
    _items: dict[str, Item] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def create(self, name: str, quantity: int) -> Item:
        with self._lock:
            item = Item(id=str(uuid4()), name=name, quantity=quantity)
            self._items[item.id] = item
            return item

    def get(self, item_id: str) -> Item:
        try:
            return self._items[item_id]
        except KeyError as exc:
            raise ItemNotFoundError(item_id) from exc

    def list(self) -> list[Item]:
        return list(self._items.values())

    def update(self, item_id: str, *, name: str | None = None, quantity: int | None = None) -> Item:
        with self._lock:
            item = self.get(item_id)
            if name is not None:
                item.name = name
            if quantity is not None:
                item.quantity = quantity
            return item

    def delete(self, item_id: str) -> None:
        with self._lock:
            if item_id not in self._items:
                raise ItemNotFoundError(item_id)
            del self._items[item_id]

    def reset(self) -> None:
        with self._lock:
            self._items.clear()
