# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) in the [MADR](https://adr.github.io/madr/) format. Each ADR captures the context, the decision, the consequences, and the alternatives considered for a non-obvious choice in this repo.

## Index

| ID                                        | Title                                                 | Status   |
| ----------------------------------------- | ----------------------------------------------------- | -------- |
| [0001](0001-use-fastapi-over-flask.md)    | Use FastAPI over Flask                                | Accepted |
| [0002](0002-no-pom-in-cypress.md)         | No Page Object Model in Cypress                       | Accepted |
| [0003](0003-no-test-class-inheritance.md) | No test-class inheritance in pytest                   | Accepted |
| [0004](0004-single-port-spa-deploy.md)    | Single-port SPA deploy (FastAPI serves the built SPA) | Accepted |

## Adding a new ADR

1. Copy `0001-use-fastapi-over-flask.md` to `000N-your-decision.md`.
2. Fill in Status, Context, Decision, Consequences, and Alternatives Considered.
3. Add a row to the index above.
4. Reference the ADR from the code if the decision is non-obvious there.
