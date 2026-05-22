# Summary

<!-- One paragraph describing what changed and why. Link to the ADR if applicable. -->

## Test plan

- [ ] Backend unit + integration (`cd demo-app && uv run pytest`)
- [ ] Frontend component (`cd web && pnpm test`)
- [ ] API E2E (`cd pytest-api && uv run pytest`)
- [ ] Playwright (`cd playwright && pnpm test`)
- [ ] Cypress (`cd cypress && pnpm cypress run`)
- [ ] Schemathesis contract checks pass against the running server
- [ ] No new high-severity a11y violations (Playwright `a11y.spec.ts`)
- [ ] Pre-commit hooks pass locally (`pre-commit run --all-files`)

## Screenshots / recordings

<!-- For UI changes, attach before/after screenshots or a short Loom. -->

## Linked issues

<!-- Closes #N -->

## Risk and rollback

<!-- Highest-risk area touched, blast radius, and how to roll back if needed. -->
