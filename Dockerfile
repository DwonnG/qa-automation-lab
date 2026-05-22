# syntax=docker/dockerfile:1.7

###############################################
# Stage 1: build the React SPA with pnpm
###############################################
FROM node:22-alpine AS web-build
WORKDIR /app/web

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY web/package.json web/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY web/. ./
RUN pnpm build

###############################################
# Stage 2: install backend with uv
###############################################
FROM python:3.13-slim AS backend-build
WORKDIR /app/demo-app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.10 /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/demo-app/.venv

COPY demo-app/pyproject.toml demo-app/uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

COPY demo-app/. ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

###############################################
# Stage 3: runtime
###############################################
FROM python:3.13-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=backend-build /app/demo-app/.venv /app/demo-app/.venv
COPY --from=backend-build /app/demo-app/src /app/demo-app/src
COPY --from=backend-build /app/demo-app/pyproject.toml /app/demo-app/pyproject.toml
COPY --from=web-build /app/web/dist /app/web/dist

ENV PATH="/app/demo-app/.venv/bin:${PATH}" \
    PYTHONPATH=/app/demo-app/src \
    PYTHONUNBUFFERED=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=5050

EXPOSE 5050
USER app

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://localhost:5050/api/health || exit 1

CMD ["uvicorn", "demo_app.main:app", "--host", "0.0.0.0", "--port", "5050"]
