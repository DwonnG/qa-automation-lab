from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

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
def list_items(store: Annotated[ItemStore, Depends(get_store)]) -> list[ItemRead]:
    return [ItemRead(id=i.id, name=i.name, quantity=i.quantity) for i in store.list()]


@router.post(
    ITEMS_PATH,
    response_model=ItemRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_bearer)],
    responses=_AUTH_RESPONSES,
)
def create_item(
    body: ItemCreate,
    store: Annotated[ItemStore, Depends(get_store)],
) -> ItemRead:
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


@router.delete(
    ITEM_DETAIL_PATH,
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_bearer)],
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
