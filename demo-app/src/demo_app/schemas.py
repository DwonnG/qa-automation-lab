from __future__ import annotations

from typing import Annotated, Any

from annotated_types import Ge, Le
from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints

PinStr = Annotated[
    str,
    StringConstraints(min_length=6, max_length=6, pattern=r"^[0-9]{6}$"),
]
ItemName = Annotated[str, StringConstraints(min_length=1, max_length=80, strip_whitespace=True)]


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
