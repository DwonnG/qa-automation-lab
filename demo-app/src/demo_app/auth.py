from __future__ import annotations

import hmac
import secrets
from threading import Lock

DEMO_PIN = "000000"
_TOKEN_BYTES = 32

_issued_tokens: set[str] = set()
_lock = Lock()


class InvalidPinError(ValueError):
    pass


class InvalidTokenError(ValueError):
    pass


def issue_token(pin: str) -> str:
    if not isinstance(pin, str) or not hmac.compare_digest(pin, DEMO_PIN):
        raise InvalidPinError("invalid pin")
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    with _lock:
        _issued_tokens.add(token)
    return token


def verify_token(token: str) -> None:
    if not token or token not in _issued_tokens:
        raise InvalidTokenError("invalid or missing token")


def revoke_all() -> None:
    with _lock:
        _issued_tokens.clear()
