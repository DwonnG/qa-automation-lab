from __future__ import annotations

from typing import Any

ITEM_FIELDS = frozenset({"id", "name", "quantity"})


def _assert_item_shape(payload: Any) -> None:
    assert isinstance(payload, dict), f"expected dict, got {type(payload)!r}"
    assert ITEM_FIELDS <= set(payload.keys()), (
        f"item missing keys {ITEM_FIELDS - set(payload.keys())}"
    )
    assert isinstance(payload["id"], str) and payload["id"]
    assert isinstance(payload["name"], str) and payload["name"]
    assert isinstance(payload["quantity"], int)


def _assert_token_shape(payload: Any) -> None:
    assert isinstance(payload, dict)
    assert isinstance(payload.get("token"), str)
    assert len(payload["token"]) >= 32


def _assert_error_response(response_json: Any, *, detail: str | None = None) -> None:
    assert isinstance(response_json, dict), f"expected error dict, got {response_json!r}"
    assert "detail" in response_json, f"missing detail field: {response_json}"
    if detail is not None:
        assert response_json["detail"] == detail, response_json
