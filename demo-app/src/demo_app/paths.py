"""API route definitions."""

from __future__ import annotations

from typing import Final

API_PREFIX: Final = "/api"

HEALTH_PATH: Final = "/health"
OPENAPI_PATH: Final = "/openapi.json"
LOGIN_PATH: Final = "/login"
ITEMS_PATH: Final = "/items"
ITEM_DETAIL_PATH: Final = "/items/{item_id}"

ADMIN_PREFIX: Final = "/admin"
ADMIN_RESET_PATH: Final = "/reset"


def api(path: str) -> str:
    return f"{API_PREFIX}{path}"


def item_url(item_id: str) -> str:
    return f"{API_PREFIX}{ITEMS_PATH}/{item_id}"


HEALTH_URL: Final = api(HEALTH_PATH)
OPENAPI_URL: Final = api(OPENAPI_PATH)
LOGIN_URL: Final = api(LOGIN_PATH)
ITEMS_URL: Final = api(ITEMS_PATH)
ADMIN_RESET_URL: Final = f"{ADMIN_PREFIX}{ADMIN_RESET_PATH}"
