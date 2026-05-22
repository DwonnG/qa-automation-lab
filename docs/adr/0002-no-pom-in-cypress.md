# 0002 - No Page Object Model in Cypress

- Status: Accepted
- Date: 2026-05-22

## Context

This repo intentionally ships both Playwright and Cypress to demonstrate fluency with two dominant UI testing tools. The temptation is to apply the same architecture (Page Object Model) to both for consistency.

Cypress's own maintainers have published explicit guidance against POM: ["Stop Using Page Objects and Start Using App Actions"](https://www.cypress.io/blog/2019/01/03/stop-using-page-objects-and-start-using-app-actions). Their argument: Cypress already provides custom commands, chained subjects, and direct access to application state via `cy.window()`. Layering a class hierarchy on top of that hides Cypress's grain and creates abstractions that fight the framework.

## Decision

Use Page Object Model in Playwright. Do **not** use Page Object Model in Cypress.

Cypress test interactions live in:

- **Custom commands** in `cypress/support/commands.js` (e.g., `cy.login`, `cy.addItem`).
- **App Actions** that hit the API directly to seed state, then verify the UI reflects it.
- **Direct chained subjects** for assertions, using `cy.findByRole` from `@testing-library/cypress` for accessibility-first selectors.

## Consequences

Positive:

- Each framework is used the way its maintainers endorse, which itself is a signal worth showing on a portfolio.
- Cypress tests stay short, declarative, and idiomatic.
- The Playwright suite gets to be the showcase for classical POM with an abstract `BasePage`. The Cypress suite gets to be the showcase for App Actions and `cy.session()`-backed auth caching. They complement rather than duplicate.

Negative:

- Contributors used to POM in Cypress may initially be surprised. Mitigated by this ADR and by example.
- Some duplication between the two suites in test scenarios. Acceptable, because the duplication is _the demonstration_.

## Alternatives considered

- **POM in both suites.** Easier to maintain superficially, but throws away the chance to demonstrate framework fluency. Also fights Cypress's design.
- **App Actions in both suites.** Possible, but Playwright's official documentation centers POM, and skipping it would deprive the portfolio of a textbook example.
- **One framework only.** Defeats the purpose of the portfolio repo.
