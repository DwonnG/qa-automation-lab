from __future__ import annotations

import pytest

from demo_app.auth import (
    DEMO_PIN,
    InvalidPinError,
    InvalidTokenError,
    issue_token,
    revoke_all,
    verify_token,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clean_tokens() -> None:
    revoke_all()


class TestIssueToken:
    def test_valid_pin_returns_opaque_token(self) -> None:
        token = issue_token(DEMO_PIN)
        assert isinstance(token, str)
        assert len(token) >= 32

    def test_repeated_issuance_returns_distinct_tokens(self) -> None:
        a = issue_token(DEMO_PIN)
        b = issue_token(DEMO_PIN)
        assert a != b

    @pytest.mark.parametrize(
        ("pin",),
        [
            ("",),
            ("12345",),
            ("1234567",),
            ("abcdef",),
            ("000001",),
        ],
        ids=["empty", "too_short", "too_long", "non_numeric", "wrong_pin"],
    )
    def test_invalid_pin_raises(self, pin: str) -> None:
        with pytest.raises(InvalidPinError):
            issue_token(pin)

    def test_non_string_pin_raises(self) -> None:
        with pytest.raises(InvalidPinError):
            issue_token(123456)  # type: ignore[arg-type]


class TestVerifyToken:
    def test_issued_token_verifies(self) -> None:
        token = issue_token(DEMO_PIN)
        verify_token(token)

    @pytest.mark.parametrize(
        ("token",),
        [("",), ("not-real",), ("a" * 64,)],
        ids=["empty", "fake", "long_fake"],
    )
    def test_unknown_token_raises(self, token: str) -> None:
        with pytest.raises(InvalidTokenError):
            verify_token(token)

    def test_revoke_all_invalidates_tokens(self) -> None:
        token = issue_token(DEMO_PIN)
        revoke_all()
        with pytest.raises(InvalidTokenError):
            verify_token(token)
