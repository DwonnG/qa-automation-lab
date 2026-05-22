from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from demo_app.schemas import ItemCreate, ItemUpdate, LoginRequest

pytestmark = pytest.mark.unit


class TestLoginRequest:
    @pytest.mark.parametrize(
        ("pin",),
        [("000000",), ("123456",), ("999999",)],
        ids=["zeros", "sequential", "nines"],
    )
    def test_accepts_six_digit_pin(self, pin: str) -> None:
        LoginRequest.model_validate({"pin": pin})

    @pytest.mark.parametrize(
        ("payload",),
        [
            ({"pin": "12345"},),
            ({"pin": "1234567"},),
            ({"pin": "abcdef"},),
            ({"pin": "12-456"},),
            ({},),
            ({"pin": "000000", "extra": "x"},),
        ],
        ids=[
            "too_short",
            "too_long",
            "non_numeric",
            "punctuation",
            "missing_pin",
            "extra_field",
        ],
    )
    def test_rejects_invalid_payload(self, payload: dict[str, Any]) -> None:
        with pytest.raises(ValidationError):
            LoginRequest.model_validate(payload)


class TestItemCreate:
    def test_strips_whitespace_on_name(self) -> None:
        m = ItemCreate.model_validate({"name": "  apples  ", "quantity": 1})
        assert m.name == "apples"

    @pytest.mark.parametrize(
        ("payload",),
        [
            ({"name": "", "quantity": 1},),
            ({"name": "x" * 81, "quantity": 1},),
            ({"name": "x", "quantity": -1},),
            ({"name": "x", "quantity": 10_001},),
            ({"name": "x"},),
            ({"quantity": 1},),
            ({"name": "x", "quantity": 1, "extra": "y"},),
        ],
        ids=[
            "empty_name",
            "name_too_long",
            "negative_quantity",
            "quantity_too_large",
            "missing_quantity",
            "missing_name",
            "extra_field",
        ],
    )
    def test_rejects_invalid_payload(self, payload: dict[str, Any]) -> None:
        with pytest.raises(ValidationError):
            ItemCreate.model_validate(payload)


class TestItemUpdate:
    def test_all_fields_optional(self) -> None:
        m = ItemUpdate.model_validate({})
        assert m.name is None
        assert m.quantity is None

    def test_partial_update_payload(self) -> None:
        m = ItemUpdate.model_validate({"name": "x"})
        assert m.name == "x"
        assert m.quantity is None

    def test_rejects_extra_fields(self) -> None:
        with pytest.raises(ValidationError):
            ItemUpdate.model_validate({"name": "x", "rogue": True})
