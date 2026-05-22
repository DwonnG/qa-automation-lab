from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Self

import httpx

from helpers.paths import ITEMS_URL, LOGIN_URL


class BaseApiClient(ABC):
    DEFAULT_TIMEOUT = 5.0

    def __init__(
        self,
        base_url: str,
        *,
        token: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout or self.DEFAULT_TIMEOUT,
        )
        self._token = token

    @property
    @abstractmethod
    def resource_path(self) -> str: ...

    @property
    def token(self) -> str | None:
        return self._token

    def set_token(self, token: str | None) -> None:
        self._token = token

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        return self._client.request(
            method,
            path,
            json=json,
            params=params,
            headers=self._headers(headers),
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


class AuthApiClient(BaseApiClient):
    @property
    def resource_path(self) -> str:
        return LOGIN_URL

    def login(self, pin: str) -> httpx.Response:
        return self._request("POST", self.resource_path, json={"pin": pin})


class ItemsApiClient(BaseApiClient):
    @property
    def resource_path(self) -> str:
        return ITEMS_URL

    def list(self) -> httpx.Response:
        return self._request("GET", self.resource_path)

    def create(self, *, name: str, quantity: int) -> httpx.Response:
        return self._request("POST", self.resource_path, json={"name": name, "quantity": quantity})

    def get(self, item_id: str) -> httpx.Response:
        return self._request("GET", f"{self.resource_path}/{item_id}")

    def update(
        self,
        item_id: str,
        *,
        name: str | None = None,
        quantity: int | None = None,
    ) -> httpx.Response:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if quantity is not None:
            body["quantity"] = quantity
        return self._request("PUT", f"{self.resource_path}/{item_id}", json=body)

    def delete(self, item_id: str) -> httpx.Response:
        return self._request("DELETE", f"{self.resource_path}/{item_id}")
