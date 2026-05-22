# demo-app

FastAPI backend with PIN auth and in-memory items CRUD. Serves the built `web/dist/` SPA on the same port.

## Run

```bash
uv sync
uv run uvicorn demo_app.main:app --port 5050
```

OpenAPI docs at `http://localhost:5050/api/docs`. Demo PIN: `000000`.

## Test

```bash
uv run pytest                          # unit + integration with coverage
uv run pytest -m unit                  # only the unit subset
uv run pytest -m integration           # only the integration subset
uv run ruff check . && uv run ruff format --check .
```

## Module layout

| File                      | Responsibility                                    |
| ------------------------- | ------------------------------------------------- |
| `src/demo_app/main.py`    | App factory, static-files mount, SPA fallback     |
| `src/demo_app/routes.py`  | APIRouter under `/api`, dependency-injected auth  |
| `src/demo_app/store.py`   | `ItemStore` in-memory CRUD, pure stdlib           |
| `src/demo_app/auth.py`    | Token issue and verify, constant-time PIN compare |
| `src/demo_app/schemas.py` | Pydantic v2 request and response models           |
