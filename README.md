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
| 7b | Parent dashboard, child profiles and sign-in (username + PIN), goals | ✅ done |
| 7c | Child play area and game player: all 5 games, microphone answers, results | ✅ done |
| 7d | Progress charts, printable reports, the child's "My progress", route-based code splitting | ✅ done |
| 7e | Care team (invite/revoke per child), therapist dashboard, notes and learning plans, admin approvals | ✅ done |
| 8–9 | PWA/offline, deploy | ⏳ next |

## Tech stack

- **Frontend:** React 19, TypeScript (strict), Vite, Tailwind CSS v4, React Router 7, TanStack Query 5,
  openapi-fetch + openapi-typescript (API types generated from the backend), react-hook-form + zod,
  visx (scale, shape, axis, group) for SVG charts;
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
  features/          auth/ (login, sign up, verify email, forgot password), children/ (parent dashboard,
                     child form, child page, child sign-in), goals/, play/ (child home, game player,
                     answers, microphone recording, results), progress/ (parent progress + report,
                     the child's "My progress", range filter, data transforms, charts/), careTeam/
                     (parent invites/removes therapists; therapist link queries), notes/, plans/
                     (learning plans), therapist/ (dashboard, linked-child gate, child page),
                     admin/ (approvals, therapist accounts), home/, landing/
  components/ui/     Button/LinkButton, TextField/PasswordField, fields (select, textarea, chips, segmented),
                     Alert, ConfirmDialog, ProgressBar, CodeInput, PinPad, Logo, Spinner
  lib/               avatars, dates (date-only values), useCooldown
  test/              mockApi (fake backend for tests), fixtures (parent, play, progress), renderApp
```

| Path | Who | |
|---|---|---|
| `/` | anyone | landing page |
| `/login` (`?as=child` / `?as=therapist`) | signed out | tabs: parent (email + password), child (name + PIN pad), therapist |
| `/signup` (`?role=therapist`) | signed out | parent or therapist account |
| `/verify-email`, `/forgot-password` | signed out | 6-digit emailed codes |
| `/parent` | parents | dashboard: each child's week (games, minutes, streak) and sign-in status |
| `/parent/children/new`, `/parent/children/:id/edit` | parents | child profile form |
| `/parent/children/:id` | parents | the child's week, sign-in (username + PIN), goals, profile, delete |
| `/parent/children/:id/progress` (`?range=week\|month\|quarter\|custom&from=&to=`) | parents | charts: scores per skill or game, levels, games per day/week, streaks, goals, badges |
| `/parent/children/:id/report` (same `?range=`) | parents | the detailed report, laid out to print or save as PDF |
| `/play` | children | game tiles with the child's level per skill, and their streak |
| `/play/games/:slug` (`?session=` to resume) | children | the game player: intro, rounds, feedback, results |
| `/play/progress` | children | "My progress": stars, best games, this week, badges, brothers and sisters this week |
| `/therapist` | therapists | waiting-for-approval state; once approved: invitations (accept / decline) and linked children |
| `/therapist/children/:id` (`/progress`, `/report`) | approved therapists with an **active** link to that child | learning plan, notes, profile; the same progress and report pages as parents; leave the care team |
| `/admin` (`?q=&status=`) | admins | counts, therapists waiting for approval (approve / reject with a reason), therapist accounts with search and status filter |

- **Sessions:** the access token is kept in memory only. On page load the app calls `/api/auth/refresh`, so the
  httpOnly cookie restores the sign-in. Because the backend ends the whole sign-in if a refresh token is used twice,
  refreshes never overlap: one request per tab, and tabs take turns through a Web Lock.
- **Guards:** a signed-out visitor is sent to sign in and then back to the page they asked for. An account that opens
  another role's area is sent to its own. Signed-in users skip the sign-in screens.
- **Children and goals:** forms check the same rules as the backend (e.g. PINs like 1111 or 1234 are refused
  before they're sent). Goal edits send only the fields that changed, so an already-passed due date is kept.
  Deleting a child, removing their sign-in or deleting a goal asks for confirmation. Deleting a child also asks
  you to type their name.
- **Game player:** the server owns each session; the client only sends answers (`{choice}`, `{sequence}` or a
  recording) and shows what the server decides: right or wrong, points, the level change, streak and new badges.
  The player is a small state machine (`play/playerReducer.ts`). The URL names the session, so a reload picks it
  up again. Round audio is fetched with the token and played from a blob, and the next round's audio is fetched
  ahead of time.
  - **Speech Practice** records about 10 seconds at most and uploads the recording; the microphone is switched off
    as soon as recording stops. If microphone permission is refused, if there's no microphone, or if the browser
    can't record, the child sees a plain explanation and can choose another game. If the server has no speech
    recognition, the game is marked "Not ready yet".
  - **Missing audio:** if a Sound Detective file isn't installed (see the backend README, `SOUNDS_DIR`), the round
    says so and lets the child pick another game; the session is abandoned, so levels aren't affected.
  - Children never request therapist notes or learning plans (the backend refuses them to children too).
- **Care team:** on a child's page the parent invites a therapist by email, sees "Invited" or "Has access", and can
  cancel an invitation or remove access (with a confirmation). The same page shows the child's learning plans and
  therapist notes, read-only.
- **Therapists:** until an admin approves the account, the dashboard shows only that state (with "Check again",
  which fetches a fresh token) and requests no invitations or children. Every `/therapist/children/:id/...` page
  sits behind `LinkedChildGate`: the page renders, and child data is requested, only if the therapist's own
  links include an **active** link to that child. Otherwise it says there's no access and sends nothing about
  the child (the backend answers 404 anyway). Therapists write notes and edit or delete only their own; they
  start, edit (only changed fields are sent) and archive plans. Archived plans stay readable as history.
- **Admin:** uses only the existing admin API (list, approve, reject therapists); counts, search and filters are
  worked out in the browser from the therapist list. Rejecting or withdrawing approval needs a reason, which the
  backend emails to the therapist. Admins never request children's data.
- **Progress and reports:**
  - **Period:** Week, Month, 3 months or a custom range (7 days to a year, ending by today). It's kept in the URL, so
    a report can be reloaded or bookmarked as it is.
  - **Charts** are SVG (visx). Each line has its own colour, marker shape and dash pattern, and is named in a
    legend, so colour is never the only cue. Each chart has a text summary for screen readers and a "Show as a
    table" view. Hovering or tapping shows the values. Up to a month, each point is a day; longer periods use
    weeks. The colours are a categorical palette checked for colour-blind separation.
  - **Printing:** "Print or save as PDF" uses the browser's print dialog, with no PDF library. Print styles hide
    the header and controls, keep sections whole, and keep chart colours.
  - **The child's page** compares a child only with themselves and their brothers and sisters, in name order with
    no ranking. It never requests the detailed report, therapist notes or learning plans.
- **Code splitting:** every page except the landing page is a lazy route (`app/routes.tsx`). The first download
  is the shell: React, the router, TanStack Query, auth and layouts. Forms (zod, react-hook-form) and charts
  (visx) load with the pages that use them. Main JS bundle: 583 kB → 362 kB minified (177 → 114 kB gzipped) in 7d;
  372 kB (117 kB gzipped) after 7e, which now also holds the JSX runtime that used to be a separate 9 kB chunk the
  shell always loaded. The charts chunk is 27 kB gzipped; the therapist and admin pages are 2–3 kB gzipped each.
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
