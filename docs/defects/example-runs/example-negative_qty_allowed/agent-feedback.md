# Agent failure review

- **Active defects:** negative_qty_allowed
- **Totals:** 2 failed · 18 passed · 0 skipped (2 suites)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

`POST /api/items` bypasses Pydantic's `Ge(0)` constraint when this flag
is on — the handler reads the raw JSON body and stores whatever
`quantity` value the client sent. The backend integration test that pins
the 422 contract and the Schemathesis property derived from the OpenAPI
`minimum: 0` schema both caught the regression.

## Failures

### 1. `backend` → tests/integration/test_items.py::TestCreateItem::test_create_invalid_body_returns_422[negative_quantity]

**What fired**

```
assert response.status_code == 422
E    assert 201 == 422
```

**Why**

The parametrized case `{"name": "x", "quantity": -1}` is expected to be
rejected before reaching the store. With `negative_qty_allowed` on, the
handler skipped the `ItemCreate` model and called
`store.create(name="x", quantity=-1)` directly.

**Suggested fix**

Remove the `defects.enabled("negative_qty_allowed")` branch in
`create_item` so the request always flows through Pydantic validation.

### 2. `schemathesis` → tests/test_openapi_contract.py::test_api[POST /api/items]

**What fired**

```
Schemathesis error: Negative quantity {"name": "drift", "quantity": -42}
was accepted with status 201 — schema requires minimum: 0.
```

**Why**

Schemathesis generates property-based payloads from the OpenAPI spec. It
correctly identified that negative quantities violate the published
contract and observed the server breaking that contract.

**Suggested fix**

Same one-line removal as above. Re-run with
`schemathesis run --base-url http://localhost:8000 /openapi.json` to
confirm zero contract violations.

## Where to look in code

- `demo-app/src/demo_app/routes.py:create_item`
- `demo-app/src/demo_app/schemas.py:ItemCreate.quantity`
