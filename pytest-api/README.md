# pytest-api

End-to-end API tests for the demo backend. Patterns follow `python-raptor/end_to_end_tests` and `directory-data/test/end_to_end_tests`: concrete flat test classes, fixture-driven setup, module-level `_assert_*` helpers, and parallel / randomized execution via `pytest-xdist` and `pytest-randomly`.

## Run against a local server

```bash
# 1. start the backend
cd ../demo-app && uv run uvicorn demo_app.main:app --port 5050

# 2. run the suite
cd pytest-api
uv sync
uv run pytest                       # parallel + randomized
uv run pytest -m smoke              # only the smoke subset
uv run pytest --base-url=http://staging.example.com   # against a different env
```

## Layout

| File                       | Responsibility                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- |
| `conftest.py`              | `base_url`, `auth_client`, `items_client`, `auth_token`, `created_item` fixtures |
| `helpers/api_client.py`    | `BaseApiClient` (ABC) + `AuthApiClient` + `ItemsApiClient`                       |
| `helpers/assertions.py`    | `_assert_item_shape`, `_assert_error_response`, etc.                             |
| `tests/test_health.py`     | `/health` smoke                                                                  |
| `tests/test_auth.py`       | login success and failure modes                                                  |
| `tests/test_items_crud.py` | full CRUD lifecycle                                                              |
| `tests/test_validation.py` | edge cases and validation errors                                                 |
