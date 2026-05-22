"""API paths the E2E suite targets."""

from __future__ import annotations

from typing import Final

API_PREFIX: Final = "/api"

LOGIN_URL: Final = f"{API_PREFIX}/login"
ITEMS_URL: Final = f"{API_PREFIX}/items"
HEALTH_URL: Final = f"{API_PREFIX}/health"
OPENAPI_URL: Final = f"{API_PREFIX}/openapi.json"


def item_url(item_id: str) -> str:
    return f"{ITEMS_URL}/{item_id}"
