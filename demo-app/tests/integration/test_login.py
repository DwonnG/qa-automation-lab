from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from demo_app.auth import DEMO_PIN
from demo_app.paths import LOGIN_URL

pytestmark = pytest.mark.integration


class TestLoginSuccess:
    def test_valid_pin_returns_token(self, client: TestClient) -> None:
        response = client.post(LOGIN_URL, json={"pin": DEMO_PIN})
        assert response.status_code == 200
        body = response.json()
        assert "token" in body
        assert isinstance(body["token"], str)
        assert len(body["token"]) >= 32


class TestLoginFailures:
    @pytest.mark.parametrize(
        ("payload", "expected_status"),
        [
            ({"pin": "111111"}, 401),
            ({"pin": ""}, 422),
            ({"pin": "12345"}, 422),
            ({"pin": "abcdef"}, 422),
            ({"pin": "000000", "extra": "x"}, 422),
            ({}, 422),
        ],
        ids=[
            "wrong_pin",
            "empty_pin",
            "too_short",
            "non_numeric",
            "extra_field",
            "missing_pin",
        ],
    )
    def test_invalid_payloads_rejected(
        self,
        client: TestClient,
        payload: dict,
        expected_status: int,
    ) -> None:
        response = client.post(LOGIN_URL, json=payload)
        assert response.status_code == expected_status

    def test_wrong_pin_returns_generic_message(self, client: TestClient) -> None:
        response = client.post(LOGIN_URL, json={"pin": "111111"})
        assert response.status_code == 401
        assert response.json() == {"detail": "invalid credentials"}
