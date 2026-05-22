from __future__ import annotations

import os
import time
from collections.abc import Iterator

import httpx
import pytest
from faker import Faker

from helpers.api_client import AuthApiClient, ItemsApiClient
from helpers.paths import HEALTH_URL

DEFAULT_BASE_URL = os.environ.get("BASE_URL", "http://localhost:5050")
DEMO_PIN = os.environ.get("DEMO_PIN", "000000")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--base-url",
        action="store",
        default=DEFAULT_BASE_URL,
        help="Target server base URL (default %(default)s).",
    )


@pytest.fixture(scope="session")
def base_url(request: pytest.FixtureRequest) -> str:
    return request.config.getoption("--base-url")


@pytest.fixture(scope="session", autouse=True)
def _wait_for_server(base_url: str) -> None:
    deadline = time.monotonic() + 30.0
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}{HEALTH_URL}", timeout=2.0)
            if response.status_code == 200:
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"server not reachable at {base_url}: {last_error}")


@pytest.fixture(scope="session")
def demo_pin() -> str:
    return DEMO_PIN


@pytest.fixture(scope="session")
def faker() -> Faker:
    return Faker()


@pytest.fixture
def auth_client(base_url: str) -> Iterator[AuthApiClient]:
    with AuthApiClient(base_url) as client:
        yield client


@pytest.fixture
def auth_token(auth_client: AuthApiClient) -> str:
    response = auth_client.login(DEMO_PIN)
    assert response.status_code == 200, response.text
    return response.json()["token"]


@pytest.fixture
def items_client(base_url: str, auth_token: str) -> Iterator[ItemsApiClient]:
    with ItemsApiClient(base_url, token=auth_token) as client:
        yield client


@pytest.fixture
def created_item(items_client: ItemsApiClient, faker: Faker) -> Iterator[dict]:
    response = items_client.create(name=faker.unique.word(), quantity=1)
    assert response.status_code == 201, response.text
    payload = response.json()
    yield payload
    items_client.delete(payload["id"])
