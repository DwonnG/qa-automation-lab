# Agent failure review

- **Active defects:** off_by_one_pagination
- **Totals:** 2 failed · 16 passed · 0 skipped (2 suites)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

`GET /api/items` drops the last row of every page when this flag is on
(`page_items = page_items[:-1]`). It's a textbook off-by-one — pagination
math is correct, but the slice that hands rows back to the serializer
truncates the tail. A backend integration test that fully populates the
store and a Playwright UI assertion that walks the rendered list both
caught it.

## Failures

### 1. `backend` → tests/integration/test_items.py::TestCreateItem::test_list_reflects_created_items

**What fired**

```
assert len(response.json()) == 3
E    assert 2 == 3
```

**Why**

The test seeds three items and asserts the list endpoint returns them
all. With the defect on, the response contains items #1 and #2; item #3
is sliced off before serialization.

**Suggested fix**

Remove the `page_items = page_items[:-1]` line from the
`off_by_one_pagination` branch in `list_items`. The pagination math
(`start = (page-1)*page_size; end = start + page_size`) is correct on
its own.

### 2. `playwright` → tests/items.spec.ts → "adds an item and shows it in the table"

**What fired**

```
Error: expect(locator).toHaveCount(1) failed
Locator: getByRole("row").filter({ hasText: "demo-item" })
Expected: 1
Received: 0
```

**Why**

The browser added an item, the API responded 201, but the next refresh
of the list omitted the most-recently-created row (it's the tail). The
UI assertion that walked the table to find the new row found zero
matches.

**Suggested fix**

Same one-line removal. The Playwright test is correct.

## Where to look in code

- `demo-app/src/demo_app/routes.py:list_items`
- `web/src/mocks/handlers.ts` (GET `/api/items` branch — mirrors the
  same defect for the in-browser SUT)
