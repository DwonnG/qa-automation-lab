from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from demo_app.auth import revoke_all
from demo_app.paths import (
    ADMIN_PREFIX,
    ADMIN_RESET_URL,
    API_PREFIX,
    OPENAPI_URL,
    api,
)
from demo_app.routes import router
from demo_app.store import ItemStore

WEB_DIST_DIR = Path(__file__).resolve().parents[2].parent / "web" / "dist"
_INDEX_FILE = WEB_DIST_DIR / "index.html"
_BACKEND_PREFIXES = (f"{API_PREFIX}/", f"{ADMIN_PREFIX}/")


def _is_backend_path(path: str) -> bool:
    return path.startswith(_BACKEND_PREFIXES) or path in (API_PREFIX, ADMIN_PREFIX)


def _build_http_exception_handler(spa_enabled: bool):
    """Return an exception handler that:

    - Normalizes the body-parse 400 to 422 so OpenAPI documents one body-validation status.
    - Falls back to the SPA index for non-backend 404s when ``spa_enabled``.
    - Preserves upstream response headers (e.g. Starlette's ``Allow`` on 405).
    """

    async def _handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        headers = exc.headers or {}
        if exc.status_code == status.HTTP_400_BAD_REQUEST and exc.detail == (
            "There was an error parsing the body"
        ):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "detail": [
                        {
                            "type": "body_parse_error",
                            "loc": ["body"],
                            "msg": "request body could not be decoded",
                        }
                    ]
                },
                headers=headers,
            )
        if (
            spa_enabled
            and exc.status_code == status.HTTP_404_NOT_FOUND
            and request.method == "GET"
            and not _is_backend_path(request.url.path)
        ):
            return FileResponse(_INDEX_FILE)  # type: ignore[return-value]
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=headers,
        )

    return _handler


class StrictQueryParamsMiddleware(BaseHTTPMiddleware):
    """Reject undocumented query parameters on ``/api/*`` routes.

    FastAPI ignores unknown query params by default; Schemathesis treats that
    as a contract violation.
    """

    def __init__(self, app, allowed_by_path: dict[tuple[str, str], frozenset[str]]):
        super().__init__(app)
        self._allowed = allowed_by_path

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith(API_PREFIX):
            key = (request.method.upper(), request.url.path)
            allowed = self._allowed.get(key)
            if allowed is not None:
                provided = set(request.query_params.keys())
                extras = sorted(p for p in provided if p not in allowed)
                if extras:
                    return JSONResponse(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        content={
                            "detail": [
                                {
                                    "type": "unexpected_query_parameter",
                                    "loc": ["query", name],
                                    "msg": "unexpected query parameter",
                                }
                                for name in extras
                            ]
                        },
                    )
        return await call_next(request)


def _allowed_query_params(app: FastAPI) -> dict[tuple[str, str], frozenset[str]]:
    from fastapi.routing import APIRoute

    allowed: dict[tuple[str, str], frozenset[str]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        names: set[str] = set()
        for param in route.dependant.query_params:
            names.add(param.alias or param.name)
        for method in route.methods or ():
            allowed[(method.upper(), route.path)] = frozenset(names)
    return allowed


def create_app() -> FastAPI:
    app = FastAPI(
        title="qa-automation-lab demo",
        version="0.1.0",
        docs_url=api("/docs"),
        redoc_url=api("/redoc"),
        openapi_url=OPENAPI_URL,
    )

    app.state.store = ItemStore()
    app.include_router(router)

    app.add_middleware(
        StrictQueryParamsMiddleware,
        allowed_by_path=_allowed_query_params(app),
    )

    spa_available = _INDEX_FILE.exists()
    app.add_exception_handler(
        StarletteHTTPException,
        _build_http_exception_handler(spa_enabled=spa_available),
    )

    if os.environ.get("APP_ENV") == "test":

        @app.post(ADMIN_RESET_URL, status_code=204, include_in_schema=False)
        def _reset() -> None:
            app.state.store.reset()
            revoke_all()

    _mount_spa(app, spa_available=spa_available)
    return app


def _mount_spa(app: FastAPI, *, spa_available: bool) -> None:
    if not spa_available:

        @app.get("/", include_in_schema=False)
        def _missing_dist() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={"detail": "web/dist not built; run `pnpm build` in web/"},
            )

        return

    assets_dir = WEB_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", include_in_schema=False)
    def _index() -> FileResponse:
        return FileResponse(_INDEX_FILE)


app = create_app()
