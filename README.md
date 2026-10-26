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
| 6 | Progress, reports and gamification: streaks, achievements, goals, parent/therapist reports | ✅ done |
| 7a | Frontend foundations (router, API types, role layouts, guards) and sign-in screens | ✅ done |
| 7b+ | Frontend: dashboards, children, games, reports | ⏳ next |
| 8–9 | PWA/offline, deploy | planned |

## Tech stack

- **Frontend:** React 19, TypeScript (strict), Vite, Tailwind CSS v4, React Router 7, TanStack Query 5,
  openapi-fetch + openapi-typescript (API types generated from the backend), react-hook-form + zod;
  Vitest + Testing Library, ESLint + Prettier
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

### API types

The frontend's API types are generated from the backend, never written by hand. After changing a backend route or
schema, regenerate them and commit both files:

```bash
cd frontend
pnpm gen:api   # writes src/api/openapi.json (via `python -m app.cli export-openapi`) and src/api/schema.d.ts
```

## Frontend

```
src/
  App.tsx            providers + router
  app/               routes.tsx (every screen, with guards), layouts/ (auth, parent/therapist/admin, child), query client
  api/               generated schema, `api` (authenticated) and `publicApi` (sign-in) clients, ApiError
  auth/              session (in-memory tokens + refresh), AuthProvider, route guards, post-sign-in redirects
  features/          auth/ (login, sign up, verify email, forgot password), home/ (role home pages), landing/
  components/ui/     Button, TextField/PasswordField, Alert, CodeInput, PinPad, Logo, Spinner
  test/              mockApi (fake backend for tests), renderApp (real routes in memory)
```

| Path | Who | |
|---|---|---|
| `/` | anyone | landing page |
| `/login` (`?as=child` / `?as=therapist`) | signed out | tabs: parent (email + password), child (name + PIN pad), therapist |
| `/signup` (`?role=therapist`) | signed out | parent or therapist account |
| `/verify-email`, `/forgot-password` | signed out | 6-digit emailed codes |
| `/parent`, `/therapist`, `/admin`, `/play` | that kind of account only | role areas (home pages for now) |

- **Sessions:** the access token is kept in memory only. On page load the app calls `/api/auth/refresh`, so the
  httpOnly cookie restores the sign-in. Because the backend ends the whole sign-in if a refresh token is used twice,
  refreshes never overlap: one request per tab, and tabs take turns through a Web Lock.
- **Guards:** a signed-out visitor is sent to sign in and then back to the page they asked for. An account that opens
  another role's area is sent to its own. Signed-in users skip the sign-in screens.
- **Child-friendly:** a rounded system font (nothing downloaded), every button at least 48 px tall, a big number pad
  for PINs, emoji avatars, and animations switched off under "reduce motion".

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
