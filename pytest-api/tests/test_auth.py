from __future__ import annotations

import pytest

from helpers.api_client import AuthApiClient, ItemsApiClient
from helpers.assertions import _assert_error_response, _assert_token_shape


@pytest.mark.smoke
class TestLoginSuccess:
    def test_valid_pin_returns_token(
        self,
        auth_client: AuthApiClient,
        demo_pin: str,
    ) -> None:
        response = auth_client.login(demo_pin)
        assert response.status_code == 200
        _assert_token_shape(response.json())

    def test_issued_token_authorizes_items_endpoint(
        self,
        base_url: str,
        auth_token: str,
    ) -> None:
        with ItemsApiClient(base_url, token=auth_token) as client:
            response = client.list()
        assert response.status_code == 200


@pytest.mark.regression
class TestLoginFailures:
    @pytest.mark.parametrize(
        ("pin", "expected_status"),
        [
            ("111111", 401),
            ("", 422),
            ("12345", 422),
            ("abcdef", 422),
        ],
        ids=["wrong_pin", "empty_pin", "too_short", "non_numeric"],
    )
    def test_invalid_pin_rejected(
        self,
        auth_client: AuthApiClient,
        pin: str,
        expected_status: int,
    ) -> None:
        response = auth_client.login(pin)
        assert response.status_code == expected_status
        _assert_error_response(response.json())

    def test_wrong_pin_returns_generic_message(self, auth_client: AuthApiClient) -> None:
        response = auth_client.login("111111")
        assert response.status_code == 401
        _assert_error_response(response.json(), detail="invalid credentials")
