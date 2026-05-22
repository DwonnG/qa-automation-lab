# 0001 - Use FastAPI over Flask for the demo backend

- Status: Accepted
- Date: 2026-05-22

## Context

The demo app exists to give every test suite something concrete to drive. It is not the product; it is the target. We need a Python web framework that:

- Models request and response shapes well enough for unit testing in isolation.
- Generates an OpenAPI document so the Schemathesis contract suite has something to consume.
- Has a fast in-process test client so backend integration tests do not require a real port bind.
- Is the current industry choice for new Python APIs in 2026.

Flask, Django REST Framework, and FastAPI were all on the table.

## Decision

Use FastAPI with Pydantic v2.

## Consequences

Positive:

- OpenAPI is generated automatically from typed handlers and Pydantic models. The Schemathesis suite simply points at `/api/openapi.json` and runs.
- Pydantic v2 models become the validation layer, removing a hand-written `validators.py` module.
- `fastapi.testclient.TestClient` (built on `httpx`) gives us a real in-process client for integration tests with the same call surface as the production server.
- Async-native, so future enhancements (e.g., streaming responses, background jobs) do not require a rewrite.
- TypeScript on the frontend talks to a typed contract; matching the Pydantic schemas in Zod on the client is straightforward.

Negative:

- Slightly less ubiquitous in legacy enterprises than Flask. Not a concern for this portfolio context, where modern stack is a feature.
- Tighter coupling between handler signatures and the OpenAPI spec; a careless change to a Pydantic model immediately surfaces in Schemathesis runs. This is the intent, but it raises the floor on contributor awareness.

## Alternatives considered

- **Flask + flask-pydantic + apispec.** Works, but requires manual wiring for OpenAPI generation and lacks first-class async support. The toolchain becomes a Frankenstein.
- **Django REST Framework.** Overkill for a four-endpoint demo and brings an ORM, an admin, and a migration system that nothing in this repo needs.
- **Litestar / Starlite.** Compelling, but smaller ecosystem and lower hiring-panel recognition in 2026 than FastAPI.
