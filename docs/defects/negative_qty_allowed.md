---
id: negative_qty_allowed
title: Item create accepts negative quantity
tier: api
summary: |
  POST /api/items bypasses Pydantic's `Ge(0)` validator on quantity, allowing
  the store to persist a negative inventory count.
code_path: demo-app/src/demo_app/routes.py:create_item
caught_by:
  - suite: backend
    test: tests/integration/test_items.py::test_create_invalid_body_returns_422[negative_quantity]
  - suite: schemathesis
    test: tests/test_schemathesis.py::test_api (negative qty property)
visible_in_browser: false
agent_hint: |
  When this flag is on, the handler reads the raw JSON body and calls
  store.create(name, quantity) directly, bypassing the ItemCreate Pydantic
  model. The Ge(0) constraint is skipped, so quantities like -5 are stored.
  The integration test sends {"name": "x", "quantity": -1} expecting 422 and
  will see 201 instead. Schemathesis derives this from the OpenAPI minimum:0
  constraint and asserts the server returns 4xx for negative inputs.
---

# `negative_qty_allowed`

## What the defect does

`POST /api/items` normally relies on Pydantic to reject quantities below 0
(`Quantity = Annotated[int, Ge(0), Le(10_000), ...]`). With this flag on, the
handler skips the typed body entirely, reads the raw JSON, and passes the
quantity straight into the store, which has no guard of its own.

## Code path

```python
def create_item(
    request: Request,
    store: Annotated[ItemStore, Depends(get_store)],
) -> ItemRead:
    if defects.enabled("negative_qty_allowed"):
        # DEFECT: bypass ItemCreate validation, accept raw body.
        raw = await request.json()
        item = store.create(name=str(raw["name"]), quantity=int(raw["quantity"]))
        return ItemRead(...)
    # normal path uses ItemCreate body model
```

## Why each suite catches it

- **Backend integration** — `test_create_invalid_body_returns_422` parametrizes
  over invalid bodies (`negative_quantity` is one). It sends `{"quantity": -1}`
  expecting `422`, asserts on the response shape. Flag on → server returns 201
  with `quantity: -1`, assertion fails.
- **Schemathesis** — the OpenAPI schema declares `quantity: integer >= 0`.
  Schemathesis property-tests this invariant by generating both legal and
  illegal values; with the flag on, it observes a 2xx for a negative input
  and reports a contract violation.

## Why the others don't catch it

- The frontend Zod validator (`z.coerce.number().int().min(0)`) blocks the
  number `<input>` client-side, so a visitor can't trigger this through the
  React form. Tests that bypass the form (or call the API directly) are the
  only ones that observe the bug.

## Real-world analog

Adding a "fast path" handler for a perf-sensitive endpoint that forgets to
go through the validated body model.
