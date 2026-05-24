from __future__ import annotations

from typing import Annotated, Any

from annotated_types import Ge, Le
from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints

PinStr = Annotated[
    str,
    StringConstraints(min_length=6, max_length=6, pattern=r"^[0-9]{6}$"),
]
# `strip_whitespace=True` runs before length checks, so an all-whitespace
# input like "\r" collapses to "" and fails `min_length=1`. The `pattern`
# (compiled to `re.search`, i.e. "contains at least one non-whitespace
# char") makes that constraint explicit in the published OpenAPI schema,
# which prevents schemathesis from generating "schema-compliant" inputs
# the backend would in fact reject as 422.
ItemName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, strip_whitespace=True, pattern=r"\S"),
]


def _coerce_quantity(value: Any) -> Any:
    """Accept JSON numbers (int or integer-valued float) but reject bool.

    Pydantic treats ``bool`` as an ``int`` subclass by default, which lets
    ``True``/``False`` slip through as ``1``/``0``. We explicitly reject bool
    and accept whole-number floats (e.g. ``9999.0``) to honor the JSON Schema
    contract advertised in the OpenAPI document.
    """
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid integer")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError("quantity must be a whole number")
        return int(value)
    return value


Quantity = Annotated[int, Ge(0), Le(10_000), BeforeValidator(_coerce_quantity)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    pin: PinStr


class TokenResponse(BaseModel):
    token: str


class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ItemName
    quantity: Quantity


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ItemName | None = None
    quantity: Quantity | None = None


class ItemRead(BaseModel):
    id: str
    name: str
    quantity: int


class HealthResponse(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    detail: str
