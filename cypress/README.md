# cypress

End-to-end UI tests using Cypress. Showcases the **App Actions** pattern (no Page Object Model) per [Cypress's official guidance](https://www.cypress.io/blog/2019/01/03/stop-using-page-objects-and-start-using-app-actions). Deliberate contrast with the Playwright POM suite; see [ADR-0002](../docs/adr/0002-no-pom-in-cypress.md).

Highlights:

- `cy.login` backed by **`cy.session()`** for cross-spec auth caching.
- `cy.addItem` / `cy.seedItems` App Actions hitting the API directly to set up state.
- `cy.resetStore` calling the test-only `/admin/reset` route (enabled when the backend runs with `APP_ENV=test`).
- `cy.intercept` showcase: stub list, force 500, simulate slow response.
- Accessibility-first selectors via `@testing-library/cypress` (`cy.findByRole`, `cy.findByLabelText`).

## Run

The Cypress suite expects the backend to be running on `:5050` with `APP_ENV=test` and the SPA built into `web/dist/`. The repo's CI workflow handles this; locally:

```bash
# 1. build the SPA
cd ../web && pnpm install && pnpm build

# 2. start the backend with the reset route enabled
cd ../demo-app && APP_ENV=test uv run uvicorn demo_app.main:app --port 5050

# 3. run Cypress
cd cypress
pnpm install
pnpm cypress:run                            # headless
pnpm cypress:open                           # interactive
```

## Structure

| Path                           | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `cypress.config.js`            | base URL, retries, viewport                               |
| `cypress/support/commands.js`  | `cy.login`, `cy.resetStore`, `cy.addItem`, `cy.seedItems` |
| `cypress/support/e2e.js`       | loads `@testing-library/cypress`                          |
| `cypress/fixtures/items.json`  | seeded data for table tests                               |
| `cypress/e2e/login.cy.js`      | happy path + failures                                     |
| `cypress/e2e/items.cy.js`      | seeded data + UI CRUD via App Actions                     |
| `cypress/e2e/intercepts.cy.js` | `cy.intercept` showcase                                   |
