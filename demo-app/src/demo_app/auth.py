from __future__ import annotations

import hmac
import re
import secrets
from threading import Lock

from demo_app import defects

DEMO_PIN = "000000"
_TOKEN_BYTES = 32
_PIN_SHAPE = re.compile(r"^[0-9]{6}$")

_issued_tokens: set[str] = set()
_lock = Lock()


class InvalidPinError(ValueError):
    pass


class InvalidTokenError(ValueError):
    pass


def issue_token(pin: str) -> str:
    if defects.enabled("login_accepts_any_pin"):
        # Skip the constant-time compare; accept any well-formed 6-digit PIN.
        # See docs/defects/login_accepts_any_pin.md.
        if not isinstance(pin, str) or not _PIN_SHAPE.fullmatch(pin):
            raise InvalidPinError("invalid pin")
    elif not isinstance(pin, str) or not hmac.compare_digest(pin, DEMO_PIN):
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
