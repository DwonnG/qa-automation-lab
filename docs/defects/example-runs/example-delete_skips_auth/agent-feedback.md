# Agent failure review

- **Active defects:** delete_skips_auth
- **Totals:** 2 failed · 14 passed · 0 skipped (2 suites)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

`DELETE /api/items/{id}` no longer requires a bearer token — the
`_maybe_require_bearer` dependency short-circuits to a no-op when this
flag is on. The API E2E suite (which exercises the network surface
without going through the browser) caught it immediately, and the
backend integration test that pins the 401 contract for missing
credentials caught the same regression at the unit boundary.

## Failures

### 1. `pytest-api` → tests/test_items_crud.py::test_delete_requires_bearer

**What fired**

```
assert response.status_code == 401
E    assert 204 == 401
```

**Why**

The test issued `DELETE /api/items/<id>` with no `Authorization` header,
expecting 401. The handler skipped the bearer check and deleted the row,
returning 204. Anonymous deletes are now possible.

**Suggested fix**

Remove the `delete_skips_auth` branch in `_maybe_require_bearer` so the
endpoint always depends on `require_bearer`.

### 2. `backend` → tests/integration/test_error_handling.py::TestRequireBearer::test_missing_bearer_returns_401

**What fired**

```
assert response.status_code == 401
E    assert 204 == 401
```

**Why**

Same root cause from the integration suite's perspective. The
authorization dependency is no longer enforced on the delete route.

**Suggested fix**

Same one-line revert. Both tests pass cleanly after the branch is
removed.

## Where to look in code

- `demo-app/src/demo_app/routes.py:_maybe_require_bearer`
- `demo-app/src/demo_app/routes.py:delete_item`
