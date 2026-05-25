---
id: login_accepts_any_pin
title: Login accepts any 6-digit PIN
tier: ui
category: auth
summary: |
  Any 6-digit PIN logs you in, even the wrong one.
code_path: demo-app/src/demo_app/auth.py:issue_token
caught_by:
  - suite: backend
    test: tests/unit/test_auth.py::test_issue_token_rejects_wrong_pin
  - suite: playwright
    test: tests/login.spec.ts -> "wrong PIN is rejected"
visible_in_browser: true
agent_hint: |
  When this flag is on, `hmac.compare_digest(pin, DEMO_PIN)` is short-circuited
  to True. Any PIN matching `^[0-9]{6}$` will succeed. The unit test that
  asserts a wrong PIN raises InvalidPinError will be the first to fail; the
  Playwright spec that asserts the "invalid credentials" toast will follow.
---

# `login_accepts_any_pin`

## What the defect does

`demo_app.auth.issue_token` normally rejects any input that does not match
the demo PIN via a constant-time string compare. With this flag on, the
compare is bypassed and any PIN that passes Pydantic's `^[0-9]{6}$` check
is accepted — `"123456"`, `"999999"`, anything 6 digits.

## Code path

```python
def issue_token(pin: str) -> str:
    if defects.enabled("login_accepts_any_pin"):
        # DEFECT: skip the constant-time compare, accept any 6-digit PIN.
        if not isinstance(pin, str) or not re.fullmatch(r"[0-9]{6}", pin):
            raise InvalidPinError("invalid pin")
    elif not isinstance(pin, str) or not hmac.compare_digest(pin, DEMO_PIN):
        raise InvalidPinError("invalid pin")
    # ... issue token
```

## Why each suite catches it

- **Backend unit** (`tests/unit/test_auth.py`) — directly calls
  `issue_token("wrong0")` and asserts it raises `InvalidPinError`. The
  bypass is observable without any HTTP layer.
- **Playwright UI** — types a wrong PIN into the login form, expects a
  401 → "Invalid PIN" toast. With the defect on, the form succeeds and
  the items page loads, failing the assertion.

## Why the others don't catch it

- Frontend Zod still enforces 6-digit shape, so the React form blocks
  obviously broken inputs (e.g. empty, alphabetic). The defect only
  affects PIN _value_, not shape.
- Schemathesis is concerned with the schema contract, not credential
  correctness.

## Real-world analog

Forgetting `hmac.compare_digest` in favor of `pin == DEMO_PIN`, or worse,
short-circuiting auth in a debug branch left enabled in production.
