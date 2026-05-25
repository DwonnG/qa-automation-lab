# Agent failure review

- **Active defects:** selector_drift
- **Totals:** 5 failed · 1 passed · 0 skipped (1 suite)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

The `selector_drift` flag renames the items-header primary button from
`Add item` to `Create new item`. Playwright's accessibility-first locator
(`getByRole("button", { name: /add item/i })`) anchored on the old copy,
so every spec that opens the add-item dialog times out before doing
anything else. The app is functionally fine — only the test selector is
stale. The empty-state spec is the only one that survives because it
never touches the dialog.

## Per-failure analysis

### 1. `playwright` → tests/items.spec.ts → "adds an item and shows it in the table"

**What fired**

```
TimeoutError: locator.click: Timeout 5000ms exceeded.
  waiting for getByRole('button', { name: /add item/i })
```

**Why**

`ItemsPage.openAddItemDialog()` calls `getByRole("button", { name: /add item/i })`.
With the defect on, the button's accessible name is `Create new item`,
so the locator never resolves.

**Suggested fix**

Update the page object to accept either copy, and centralize the literal so
future renames are a one-line change:

```ts
// playwright/pages/ItemsPage.ts
const ADD_ITEM_LABEL = /create new item|add item/i;

async openAddItemDialog(): Promise<void> {
  await this.page.getByRole("button", { name: ADD_ITEM_LABEL }).click();
  await expect(this.page.getByRole("dialog")).toBeVisible();
}
```

### 2. `playwright` → tests/items.spec.ts → "edits an existing item"

Same root cause — `editItem()` calls `addItem()` to seed the row, which
opens the dialog through the stale locator. Fixing `openAddItemDialog()`
heals this spec automatically.

### 3. `playwright` → tests/items.spec.ts → "deletes an item"

Same root cause and same fix as #2.

### 4. `playwright` → tests/items.spec.ts → "blocks save when the name field is empty"

Directly calls `openAddItemDialog()` before asserting the validation
alert; recovers when the page object is updated.

### 5. `playwright` → tests/a11y.spec.ts → "items page (add dialog open) has no critical accessibility issues"

Opens the same dialog through the same locator. The a11y scan never runs
because the dialog is never visible. Same fix.

## Where to look in code

- `web/src/App.tsx` — the conditional that swaps the button label
- `playwright/pages/ItemsPage.ts` — `openAddItemDialog()` is the single
  choke point; updating one regex heals all five failures
