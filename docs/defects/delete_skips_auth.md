---
id: delete_skips_auth
title: Delete works without authentication
tier: api
category: security
summary: |
  Anyone can delete items without sending an auth token.
code_path: demo-app/src/demo_app/routes.py:delete_item
caught_by:
  - suite: api-e2e
    test: pytest-api/tests/test_auth_required.py::test_delete_requires_bearer
  - suite: backend
    test: tests/integration/test_items.py::test_delete_requires_authorization
visible_in_browser: false
agent_hint: |
  When this flag is on, the bearer dependency is conditionally skipped at the
  start of the delete handler — it returns 204 (or 404 if id is missing)
  without checking the Authorization header. Tests that DELETE without a
  bearer expecting 401 will instead see 204/404. The other CRUD methods
  remain authenticated; only DELETE is affected.
---

# `delete_skips_auth`

## What the defect does

DELETE on `/api/items/{id}` normally requires a valid bearer token via
the `Depends(require_bearer)` dependency, returning 401 on missing/bad
auth. With this flag on, the handler short-circuits the auth check and
processes the deletion regardless.

## Code path

```python
def delete_item(item_id: str, store, ...):
    if not defects.enabled("delete_skips_auth"):
        # Auth is enforced by the route-level dependency; this is a
        # defense-in-depth check that the dependency was actually applied.
        pass
    # DEFECT path runs without bearer verification because the route-level
    # dependency is conditionally removed at module load.
```

The actual mechanism uses two route registrations — one with the
dependency, one without — selected at import time based on the flag.
That mirrors the real-world failure mode: someone forgets the dependency
on a single method.

## Why each suite catches it

- **API E2E (pytest-api)** — `test_delete_requires_bearer` sends DELETE
  with no Authorization header, expects 401. Flag on → 204 or 404.
- **Backend integration** — `test_delete_requires_authorization` makes
  the same assertion against the TestClient.

## Why the others don't catch it

- The frontend always sends the bearer (it has a logged-in session), so
  the React app never exercises the unauthenticated DELETE path.
- Schemathesis only tests against the documented OpenAPI surface; it
  doesn't probe "missing auth" by default.

## Real-world analog

A copy-paste in a router file omits `Depends(require_bearer)` from one
HTTP method while siblings still have it. CI's full-route auth matrix
catches it before deploy.
