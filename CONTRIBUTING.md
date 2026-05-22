# Contributing

## Prerequisites

- Python 3.13 with [`uv`](https://docs.astral.sh/uv/)
- Node 22 LTS with [`pnpm 10`](https://pnpm.io/)
- Docker (optional, for the one-command path)
- [k6](https://k6.io/docs/get-started/installation/) (optional, only for performance suite)

## Initial setup

```bash
git clone https://github.com/DwonnG/qa-automation-lab.git
cd qa-automation-lab

# Install pre-commit hooks (runs ruff, eslint, gitleaks, etc. before every commit)
uv tool install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg

# Install backend deps
cd demo-app && uv sync && cd ..

# Install frontend deps
cd web && pnpm install && cd ..

# Install test deps
cd pytest-api && uv sync && cd ..
cd schemathesis && uv sync && cd ..
cd playwright && pnpm install && pnpm exec playwright install --with-deps && cd ..
cd cypress && pnpm install && cd ..
```

## Running individual suites

| Suite                      | Path            | Command                                          |
| -------------------------- | --------------- | ------------------------------------------------ |
| Backend unit + integration | `demo-app/`     | `uv run pytest`                                  |
| Frontend component         | `web/`          | `pnpm test`                                      |
| API E2E                    | `pytest-api/`   | `uv run pytest` (server must be running)         |
| Contract                   | `schemathesis/` | `uv run pytest -n auto` (server must be running) |
| Playwright                 | `playwright/`   | `pnpm test`                                      |
| Cypress                    | `cypress/`      | `pnpm cypress run`                               |
| Performance (k6)           | `perf/`         | `k6 run items_smoke.js`                          |

## Commit format

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/). Enforced by `commitlint` in pre-commit.

Examples:

- `feat(web): add optimistic updates to items table`
- `test(playwright): add a11y assertions on items page`
- `fix(demo-app): return 401 for missing bearer instead of 403`
- `chore(deps): bump @playwright/test to 1.56.0`
- `docs(adr): add ADR-0005 for X`

## Adding an ADR

```bash
cp docs/adr/0001-use-fastapi-over-flask.md docs/adr/000N-your-decision.md
```

Edit the new file. Update `docs/adr/README.md` with a link. Reference the ADR from the relevant code if the decision is non-obvious.

## CI

CI runs on every PR. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml). The performance suite ([`perf.yml`](.github/workflows/perf.yml)) runs on `workflow_dispatch` and a weekly cron only.
