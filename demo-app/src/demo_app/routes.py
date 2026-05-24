from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from demo_app import defects
from demo_app.auth import InvalidPinError, InvalidTokenError, issue_token, verify_token
from demo_app.paths import (
    API_PREFIX,
    HEALTH_PATH,
    ITEM_DETAIL_PATH,
    ITEMS_PATH,
    LOGIN_PATH,
)
from demo_app.schemas import (
    ErrorResponse,
    HealthResponse,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    LoginRequest,
    TokenResponse,
)
from demo_app.store import ItemNotFoundError, ItemStore

router = APIRouter(prefix=API_PREFIX)
_bearer = HTTPBearer(auto_error=False)


def get_store(request: Request) -> ItemStore:
    return request.app.state.store


def require_bearer(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid authorization",
        )
    try:
        verify_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid authorization",
        ) from exc


@router.get(HEALTH_PATH, response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.post(
    LOGIN_PATH,
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}},
)
def login(body: LoginRequest) -> TokenResponse:
    try:
        token = issue_token(body.pin)
    except InvalidPinError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        ) from exc
    return TokenResponse(token=token)


_AUTH_RESPONSES: dict[int | str, dict] = {401: {"model": ErrorResponse}}
_AUTH_AND_NOT_FOUND_RESPONSES: dict[int | str, dict] = {
    **_AUTH_RESPONSES,
    404: {"model": ErrorResponse},
}


@router.get(
    ITEMS_PATH,
    response_model=list[ItemRead],
    dependencies=[Depends(require_bearer)],
    responses=_AUTH_RESPONSES,
)
def list_items(
    store: Annotated[ItemStore, Depends(get_store)],
    page: int = Query(default=1, ge=1, le=1000),
    page_size: int = Query(default=50, ge=1, le=200),
) -> list[ItemRead]:
    if defects.enabled("slow_query"):
        # Block the event loop for 400ms; k6 p95 SLO (200ms) cannot survive.
        # See docs/defects/slow_query.md.
        time.sleep(0.4)
    items = store.list()
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end]
    if defects.enabled("off_by_one_pagination") and page_items:
        # Drop the last row of every page; classic off-by-one in pagination
        # math. See docs/defects/off_by_one_pagination.md.
        page_items = page_items[:-1]
    return [
        ItemRead(id=i.id, name=i.name, quantity=i.quantity) for i in page_items
    ]


def _create_with_raw_quantity(raw: dict, store: ItemStore) -> ItemRead:
    # Defect path: skip the ItemCreate Pydantic body model entirely so the
    # Ge(0) constraint on quantity is never applied. The store accepts any
    # int. See docs/defects/negative_qty_allowed.md.
    if not isinstance(raw, dict) or "name" not in raw or "quantity" not in raw:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="name and quantity are required",
        )
    try:
        name = str(raw["name"])
        quantity = int(raw["quantity"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid name or quantity",
        ) from exc
    item = store.create(name=name, quantity=quantity)
    return ItemRead(id=item.id, name=item.name, quantity=item.quantity)


@router.post(
    ITEMS_PATH,
    response_model=ItemRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_bearer)],
    responses=_AUTH_RESPONSES,
)
async def create_item(
    request: Request,
    store: Annotated[ItemStore, Depends(get_store)],
) -> ItemRead:
    raw = await request.json()
    if defects.enabled("negative_qty_allowed"):
        return _create_with_raw_quantity(raw, store)
    try:
        body = ItemCreate.model_validate(raw)
    except ValidationError as exc:
        # Re-raise as the FastAPI variant so the standard 422 envelope
        # with errors[] array is produced (matches what the framework
        # would have built had we kept body: ItemCreate as the parameter).
        raise RequestValidationError(exc.errors()) from exc
    item = store.create(name=body.name, quantity=body.quantity)
    return ItemRead(id=item.id, name=item.name, quantity=item.quantity)


@router.get(
    ITEM_DETAIL_PATH,
    response_model=ItemRead,
    dependencies=[Depends(require_bearer)],
    responses=_AUTH_AND_NOT_FOUND_RESPONSES,
)
def get_item(
    item_id: str,
    store: Annotated[ItemStore, Depends(get_store)],
) -> ItemRead:
    try:
        item = store.get(item_id)
    except ItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="item not found",
        ) from exc
    return ItemRead(id=item.id, name=item.name, quantity=item.quantity)


@router.put(
    ITEM_DETAIL_PATH,
    response_model=ItemRead,
    dependencies=[Depends(require_bearer)],
    responses=_AUTH_AND_NOT_FOUND_RESPONSES,
)
def update_item(
    item_id: str,
    body: ItemUpdate,
    store: Annotated[ItemStore, Depends(get_store)],
) -> ItemRead:
    try:
        item = store.update(item_id, name=body.name, quantity=body.quantity)
    except ItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="item not found",
        ) from exc
    return ItemRead(id=item.id, name=item.name, quantity=item.quantity)


def _maybe_require_bearer(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    """Bearer dependency that turns into a no-op when delete_skips_auth is on.

    The route always declares this dependency; with the defect flag set we
    short-circuit the check, mirroring a real-world copy-paste where a single
    HTTP method's auth dependency was silently weakened.
    See docs/defects/delete_skips_auth.md.
    """

    if defects.enabled("delete_skips_auth"):
        return
    require_bearer(credentials)


@router.delete(
    ITEM_DETAIL_PATH,
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_maybe_require_bearer)],
    responses=_AUTH_AND_NOT_FOUND_RESPONSES,
)
def delete_item(
    item_id: str,
    store: Annotated[ItemStore, Depends(get_store)],
) -> None:
    try:
        store.delete(item_id)
    except ItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="item not found",
        ) from exc
