---
id: selector_drift
title: Add item button label renamed
tier: ui
category: test
summary: |
  The "Add item" button is relabeled "Create new item" so Playwright's
  accessibility-first locator misses it.
code_path: web/src/App.tsx (Button label inside the items header)
caught_by:
  - suite: playwright
    test: tests/items.spec.ts -> "adds an item and shows it in the table"
  - suite: playwright
    test: tests/items.spec.ts -> "edits an existing item"
  - suite: playwright
    test: tests/items.spec.ts -> "deletes an item"
  - suite: playwright
    test: tests/items.spec.ts -> "blocks save when the name field is empty"
  - suite: playwright
    test: tests/a11y.spec.ts -> "items page (add dialog open) has no critical accessibility issues"
visible_in_browser: true
agent_hint: |
  When this flag is on, the items header renders the primary button as
  "Create new item" instead of "Add item". Every Playwright test that
  opens the dialog through `getByRole("button", { name: /add item/i })`
  times out because the accessible name no longer matches. The fix is a
  self-healing test concern, not an app bug — point the page object at
  the new copy (or both old and new via a regex), or centralize the
  button name as a constant on `ItemsPage` so future renames touch one
  line instead of fanning across specs.
---

# `selector_drift`

## What the defect does

`web/src/App.tsx` normally renders the items-header primary action as a
button labeled **"Add item"**. With this flag on, the same button renders
as **"Create new item"** — the click handler, role, and visual placement
are all unchanged. To a real user the page still works; to a Playwright
locator that anchored on the literal label, the button has vanished.

## Code path

```tsx
<Button onClick={() => setDialogMode({ kind: "create" })}>
  {defectEnabled("selector_drift") ? "Create new item" : "Add item"}
</Button>
```

## Why each suite catches it

- **Playwright UI** — `ItemsPage.openAddItemDialog()` calls
  `page.getByRole("button", { name: /add item/i })` and times out when
  the defect is on. Four tests in `items.spec.ts` plus the
  add-dialog-open scan in `a11y.spec.ts` fail with a locator timeout.

## Why the others don't catch it

- The backend, contract suite, and k6 don't touch the DOM — they only
  see the API surface, which is unchanged.
- Vitest component tests assert against the React tree directly with
  their own queries that don't depend on the button copy.

## Real-world analog

A designer or PM renames a button in a copy review ("Add item" → "Create
new item") without grepping the test suite. The change ships green
through unit + integration, then the UI E2E lane goes red overnight.
The fix isn't to revert the copy — the new label is correct — but to
update the locator and ideally centralize the literal so the next
rename is one line, not a sweep.
