---
id: off_by_one_pagination
title: List endpoint drops the last item on every page
tier: integration
summary: |
  GET /api/items supports `page` and `page_size` query params. The slice math
  in the defect path uses `items[start:end - 1]`, silently truncating the
  last row of every page.
code_path: demo-app/src/demo_app/routes.py:list_items
caught_by:
  - suite: backend
    test: tests/integration/test_items.py::test_list_pagination_returns_full_page
  - suite: playwright
    test: tests/items.spec.ts -> "list shows all seeded items"
visible_in_browser: true
agent_hint: |
  When this flag is on, the slice in list_items becomes items[start:end - 1]
  instead of items[start:end]. With 3 seeded items and page_size=10, the
  endpoint returns 2 items. The integration test seeds N items and asserts
  the list has N rows; with the defect on it has N-1. The Playwright test
  asserts row count in the UI; same failure shape.
---

# `off_by_one_pagination`

## What the defect does

`GET /api/items` accepts `?page=1&page_size=10` (1-indexed page, defaults
`page=1`, `page_size=50`). Normally the handler returns
`all_items[start:end]`. With this flag on, the slice is
`all_items[start:end - 1]` — every page silently drops its last row.

## Code path

```python
def list_items(page: int = 1, page_size: int = 50, ...):
    start = (page - 1) * page_size
    end = start + page_size
    if defects.enabled("off_by_one_pagination"):
        # DEFECT: subtract 1 from the upper bound — drops the last row.
        end -= 1
    return store.list()[start:end]
```

## Why each suite catches it

- **Backend integration** — `test_list_pagination_returns_full_page` POSTs
  N items, GETs `/api/items?page=1&page_size=N`, asserts the response has
  exactly N entries. Flag on → N-1 entries.
- **Playwright UI** — seeds 3 items (via API), asserts the rendered table
  has 3 rows. Flag on → 2 rows.

## Why the others don't catch it

- Backend unit tests target `ItemStore.list()` (the raw store) which is
  not sliced. The defect lives at the route layer.
- Schemathesis verifies the response shape, not row counts.
- k6 doesn't assert on row counts; only latency.

## Real-world analog

A junior dev replaces native slice with manual index math and writes
`for i in range(start, end - 1)` because they confused inclusive vs
exclusive bounds.
