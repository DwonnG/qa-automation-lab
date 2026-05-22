# schemathesis

OpenAPI contract and property-based tests driven entirely from the FastAPI-generated spec at `/api/openapi.json`. Catches:

- Endpoints whose responses don't conform to their declared schema.
- HTTP status codes not listed in the OpenAPI document.
- Missing or unexpected response headers.
- Slow responses (configurable threshold).
- Crashes from generated edge-case payloads (per Pydantic constraints).

## Run

```bash
# 1. start the backend
cd ../demo-app && uv run uvicorn demo_app.main:app --port 5050

# 2. run the suite
cd schemathesis
uv sync

# CLI form (recommended for CI)
uv run schemathesis run --checks all \
  --hypothesis-database=none \
  --base-url http://localhost:5050 \
  http://localhost:5050/api/openapi.json

# pytest form (richer reporting, links into the same checks)
uv run pytest
```

## Notes

- The CLI form integrates well with GitHub Actions and reports a cassette of failing payloads.
- Stateful link traversal is on by default; the spec exposes CRUD link relations so Schemathesis follows `POST /api/items` -> `GET /api/items/{id}` -> `PUT` -> `DELETE`.
- Bearer auth is supplied via `--header "Authorization: Bearer <token>"` in CI; local runs can use `SCHEMATHESIS_TOKEN=...` and re-run after `POST /api/login`.
