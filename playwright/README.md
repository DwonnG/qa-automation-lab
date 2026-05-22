# playwright

End-to-end UI tests using Playwright with TypeScript. Showcases:

- POM with abstract `BasePage` and concrete `LoginPage` / `ItemsPage` subclasses.
- Accessibility-first selectors (`getByRole`, `getByLabel`) - never CSS classes.
- API-issued bearer token piped into `sessionStorage` via `page.addInitScript()` for fast, deterministic auth.
- Cross-browser projects: Chromium, Firefox, WebKit, Mobile Safari.
- Visual smoke via `toHaveScreenshot()`.
- Axe-core accessibility scans on every key view.

## Run

```bash
pnpm install
pnpm exec playwright install --with-deps
pnpm test                       # all projects, headless
pnpm test:headed                # headed Chromium
pnpm exec playwright test --project=chromium tests/login.spec.ts
pnpm exec playwright show-report
```

The config's `webServer` block auto-starts `uv run uvicorn demo_app.main:app --port 5050` from `../demo-app/` with `APP_ENV=test` to enable the `/admin/reset` route used by the auth fixture.

## Structure

| Path                       | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `pages/BasePage.ts`        | abstract base: `url`, `waitForReady()`, `goto()`, shared helpers |
| `pages/LoginPage.ts`       | `loginWith(pin)`, error assertion                                |
| `pages/ItemsPage.ts`       | `addItem`, `editItem`, `deleteItem`, table assertions            |
| `fixtures/auth.fixture.ts` | API-issued token + reset-store fixture                           |
| `tests/login.spec.ts`      | happy path + failure modes                                       |
| `tests/items.spec.ts`      | CRUD lifecycle                                                   |
| `tests/visual.spec.ts`     | screenshot smoke                                                 |
| `tests/a11y.spec.ts`       | axe-core accessibility checks                                    |
