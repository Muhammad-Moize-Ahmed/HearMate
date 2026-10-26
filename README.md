# HearMate

AI-assisted auditory-training Progressive Web App for children with Auditory Processing Disorder (APD/CAPD).
Children play adaptive listening and speech exercises; parents and therapists follow their progress.

> Final Year Project S25BS027, University of Central Punjab. This is a ground-up rebuild.
> The full analysis and roadmap are in [docs/PLAN.md](docs/PLAN.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Repo foundation: layout, tooling, CI, local Postgres | ✅ done |
| 1 | Backend core: config, DB models, migrations, logging, error format, health checks | ✅ done |
| 2 | Authentication and role-based access (backend) | ✅ done |
| 3 | Children, goals, therapist linking (backend) | ✅ done |
| 4 | Therapy game engine (backend): 5 games, adaptive levels, server-side scoring | ✅ done |
| 5 | Speech services: Whisper STT, Piper TTS, server-rendered audio, pronunciation scoring | ✅ done |
| 6 | Progress, reports and gamification | ⏳ next |
| 7–9 | Frontend, PWA/offline, deploy | planned |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Vitest + Testing Library, ESLint + Prettier
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 17 (psycopg 3), pydantic-settings; pytest, ruff, mypy (strict)
- **Tooling:** [uv](https://docs.astral.sh/uv/) for Python, [pnpm](https://pnpm.io/) for Node, Docker Compose, pre-commit + gitleaks, GitHub Actions

## Repository layout

```
backend/     FastAPI service (app/, tests/, pyproject.toml, uv.lock)
frontend/    React + Vite app (src/, package.json, pnpm-lock.yaml)
docs/        PLAN.md: analysis of the old app and the rebuild roadmap
.github/     CI workflow
docker-compose.yml   local PostgreSQL
```

## Prerequisites

- Node.js ≥ 22 and pnpm 12 (`brew install pnpm`)
- uv (`brew install uv`); it installs Python 3.12 for you
- Docker Desktop (for PostgreSQL)
- ffmpeg (`brew install ffmpeg`), used for speech audio
- Optional: pre-commit and gitleaks (`brew install pre-commit gitleaks`)

## Getting started

```bash
# 1. Environment: copy the examples and fill in your own local values (never commit .env files)
cp .env.example .env
cp frontend/.env.example frontend/.env.local

# 2. Database
docker compose up -d db          # Postgres on 127.0.0.1:5432
docker compose ps                # wait until "healthy"

# 3. Backend: http://localhost:8000/api/docs
cd backend
uv sync
uv run alembic upgrade head      # create/upgrade the schema
uv run python -m app.cli sync-games   # load the game catalogue
uv run python -m app.cli speech-setup # one-off: download speech models (~200 MB, outside the repo)
uv run python -m app.cli create-admin --email you@example.com   # optional: first admin
uv run uvicorn app.main:app --reload   # in dev, emailed codes are printed in this log

# 4. Frontend: http://localhost:5173 (in a second terminal)
cd frontend
pnpm install
pnpm dev
```

The frontend calls relative `/api/...` URLs. In development, Vite proxies them to the backend
(`API_PROXY_TARGET`, default `http://localhost:8000`), so no backend host is hardcoded in the app.
The home page shows **API online** once both servers are running.
`GET /api/health/ready` also checks the database connection.

## Quality checks

| | Backend (`cd backend`) | Frontend (`cd frontend`) |
|---|---|---|
| Lint | `uv run ruff check .` | `pnpm lint` |
| Format | `uv run ruff format .` | `pnpm format` |
| Types | `uv run mypy` | `pnpm typecheck` |
| Tests | `uv run pytest` | `pnpm test` |
| Build | n/a | `pnpm build` |

CI (`.github/workflows/ci.yml`) runs all of these on every push to `main` and on every pull request, plus a gitleaks secret scan.

To run the same checks locally on each commit, enable the git hooks once: `pre-commit install`.

## Security rules for this repo

- Never commit `.env` files, keys, certificates, user uploads or recorded audio (see `.gitignore`).
- Only `VITE_*` variables reach the browser bundle, so never put secrets in them.
- Credentials for external services (speech, email, LLM) are configured only through environment variables on the host.
