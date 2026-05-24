# Agent failure review

- **Active defects:** login_accepts_any_pin
- **Totals:** 2 failed · 12 passed · 0 skipped (2 suites)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

The `login_accepts_any_pin` flag short-circuits the constant-time PIN
comparison in `demo_app.auth.issue_token`. Any well-formed 6-digit PIN is
accepted instead of being checked against `DEMO_PIN`. Both the backend
unit test that pins the failure path and the Playwright spec that asserts
the rejection toast caught the regression on the first run.

## Failures

### 1. `backend` → tests/unit/test_auth.py::TestIssueToken::test_issue_token_rejects_wrong_pin

**What fired**

```
AssertionError: DID NOT RAISE <class 'demo_app.auth.InvalidPinError'>
```

**Why**

`issue_token("000000")` should raise `InvalidPinError` because the demo
PIN is `123456`. With `login_accepts_any_pin` on, the handler skips
`hmac.compare_digest` and returns a token instead.

**Suggested fix**

Remove the early-return branch in `issue_token` (see
[`docs/defects/login_accepts_any_pin.md`](../../login_accepts_any_pin.md))
and re-run `pytest demo-app/tests/unit/test_auth.py` to confirm.

### 2. `playwright` → tests/login.spec.ts → "rejects a wrong PIN with a generic error"

**What fired**

```
Error: expect(locator).toBeVisible() failed
Locator: getByText(/invalid credentials/i)
Expected: visible
Received: <element not found>
```

**Why**

The browser, talking to the defect-flag-aware MSW handler, was
authenticated with PIN `000000` and redirected to `/items`. The error
toast never rendered because the request returned 200 with a token.

**Suggested fix**

Same flag toggle on the backend fixes the MSW handler — both branches
read from the same defect catalog and the test passes on the next run.

## Where to look in code

- `demo-app/src/demo_app/auth.py:issue_token`
- `web/src/mocks/handlers.ts` (POST `/api/auth/login` branch)
