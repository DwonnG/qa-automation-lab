# 0004 - Single-port SPA deploy (FastAPI serves the built SPA)

- Status: Accepted
- Date: 2026-05-22

## Context

The repo has two codebases: a FastAPI backend in `demo-app/` and a React 19 + Vite SPA in `web/`. There are two reasonable ways to run them in production and in E2E:

1. **Two ports.** FastAPI on `:5050`, a separate static file server (nginx, Vite preview, or similar) on a different port. Tests need to coordinate two services.
2. **Single port.** Build the SPA to `web/dist/`, mount it as static files in FastAPI, serve `/api/*` and `/` from the same uvicorn process.

The E2E suites (`pytest-api`, `playwright`, `cypress`, `schemathesis`) each need a target. Coordinating two services in CI for each suite multiplies fragility.

## Decision

Use a single-port deploy. FastAPI serves `web/dist/` at `/` with an SPA fallback to `index.html` for client-side routes. The API lives under `/api/*`. Dev mode is the exception: Vite dev server on `:5173` with `/api/*` proxied to FastAPI on `:5050` for hot module reload.

## Consequences

Positive:

- Every E2E suite has one URL to point at: `http://localhost:5050`.
- CORS is unnecessary in production-shaped runs; everything is same-origin.
- The Docker image is one stage, one entrypoint, one healthcheck.
- Matches the realistic deploy shape for small apps in 2026 (single uvicorn behind a load balancer).

Negative:

- The backend ships frontend assets, which couples release cadence in theory. In this repo it is irrelevant; for a real product, the same pattern is fine until ~50 frontend devs.
- Static file serving in Python is slightly slower than nginx; not a measured concern for this repo's traffic profile.

## Alternatives considered

- **Two-port with reverse proxy in front (e.g., Traefik).** More realistic for large production setups; overkill for a portfolio demo and triples CI setup time.
- **Static hosting on GitHub Pages with backend on Fly.io.** Splits the repo from "one command to run everything" to "configure two providers"; defeats the demo intent.
- **Server-side rendering with Next.js.** Different architecture, different tradeoffs, out of scope. Would warrant its own ADR.
