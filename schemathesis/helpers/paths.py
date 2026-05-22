"""API paths Schemathesis needs ahead of schema discovery."""

from __future__ import annotations

from typing import Final

API_PREFIX: Final = "/api"

LOGIN_URL: Final = f"{API_PREFIX}/login"
OPENAPI_URL: Final = f"{API_PREFIX}/openapi.json"
HEALTH_URL: Final = f"{API_PREFIX}/health"
ITEMS_URL: Final = f"{API_PREFIX}/items"
ITEM_DETAIL_URL: Final = f"{API_PREFIX}/items/{{item_id}}"

REQUIRED_DOCUMENTED_PATHS: Final = (HEALTH_URL, LOGIN_URL, ITEMS_URL, ITEM_DETAIL_URL)
