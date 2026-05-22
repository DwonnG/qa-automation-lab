from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from demo_app.auth import DEMO_PIN, revoke_all
from demo_app.main import create_app
from demo_app.paths import LOGIN_URL
from demo_app.store import ItemStore


@pytest.fixture
def app() -> Iterator[FastAPI]:
    instance = create_app()
    instance.state.store = ItemStore()
    revoke_all()
    yield instance
    revoke_all()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_token(client: TestClient) -> str:
    response = client.post(LOGIN_URL, json={"pin": DEMO_PIN})
    response.raise_for_status()
    return response.json()["token"]


@pytest.fixture
def auth_headers(auth_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def store() -> ItemStore:
    return ItemStore()
