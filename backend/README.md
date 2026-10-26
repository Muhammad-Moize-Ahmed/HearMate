# HearMate backend

FastAPI service for HearMate. See the root `README.md` for full setup and [../docs/PLAN.md](../docs/PLAN.md) for the roadmap.

```bash
uv sync                                   # install deps into .venv
uv run alembic upgrade head               # apply migrations (needs: docker compose up -d db)
uv run uvicorn app.main:app --reload      # http://localhost:8000/api/docs
uv run pytest                             # all tests (DB tests use a separate <db>_test database)
uv run pytest -m "not db"                 # only tests that don't need PostgreSQL
uv run ruff check . && uv run ruff format --check . && uv run mypy
uv run python -m app.cli create-admin --email you@example.com   # prompts for a password
```

## Layout

```
app/
  main.py            app factory: middleware, error handlers, routers, app.state
  cli.py             operator commands (create-admin)
  core/
    config.py        settings from env / .env (pydantic-settings); production safety checks
    logging.py       JSON or console logs, each line tagged with the request ID
    middleware.py    request ID (X-Request-ID), one access-log line per request, crash -> JSON 500
    errors.py        AppError hierarchy and the single error response shape
    deps.py          dependencies for app.state objects (settings, rate limiter, email) + client IP
    audit.py         record_event(): append to audit_log
  auth/
    principal.py     Principal (parent | therapist | admin | child)
    deps.py          get_principal: the ONE place a token becomes a Principal; require_* guards
    policies.py      can_view_child / can_edit_child / can_manage_plan (+ get_* helpers)
    tokens.py        access JWTs, opaque refresh tokens, HMAC'd one-time codes
    passwords.py     argon2 hashing for passwords and PINs
    rate_limit.py    in-memory sliding-window limiter
  providers/
    email/           EmailSender interface; console (dev) and SMTP backends
  db/
    base.py          declarative Base, constraint naming, UUID/timestamp mixins, str_enum()
    session.py       engine, sessionmaker, get_db dependency
    models/          one module per area (users, children, therapists, games, progress, ...)
  modules/
    health/          GET /api/health (liveness), GET /api/health/ready (database check)
    auth/            /api/auth/*: signup, verify-email, login, child-login, refresh, logout, password reset, me
    admin/           /api/admin/therapists: list, approve, reject
alembic/             migrations; versions/ starts from a single baseline
tests/               unit tests; tests/db/ needs PostgreSQL
```

## Conventions

- **Errors:** raise `AppError` subclasses (`NotFoundError`, `ConflictError`, ...). Every error response is
  `{"error": {"code", "message", "details"?, "request_id"}}`. Validation errors never echo submitted values.
- **Schema changes:** edit the models, then `uv run alembic revision --autogenerate -m "..."`, review the file,
  and `uv run alembic upgrade head`. CI runs `alembic check` and fails if models and migrations drift apart.
- **Data types:** UUID primary keys, `timestamptz` for all times, enums stored as VARCHAR + CHECK
  (`str_enum`), foreign keys with explicit `ON DELETE` behaviour.

## Authentication and access control

| Who | How they sign in | Notes |
|---|---|---|
| Parent | email + password, after verifying the email with a 6-digit code | signs up at `/auth/signup` |
| Therapist | same as parent (`role: "therapist"`) | can sign in while pending, but therapist routes need admin approval |
| Admin | email + password | created only with `python -m app.cli create-admin` |
| Child | username + PIN set by their parent | scoped to that one child |

- **Tokens:** `POST /auth/login` (or `/verify-email`, `/child-login`) returns a 15-minute access token in the body;
  send it as `Authorization: Bearer ...` and keep it in memory, not localStorage. The refresh token is an httpOnly
  cookie (`hm_refresh`, path `/api/auth`). `POST /auth/refresh` rotates it; reusing an old one ends the whole session.
- **Every request** re-checks the account in `get_principal` (disabled or deleted accounts lose access immediately).
- **Child data:** route handlers must load children through `get_viewable_child`, `get_editable_child` or
  `get_plan_managed_child`. A caller who can't see a child gets 404, so IDs reveal nothing. Admins have no access to
  children's therapy data.
- **Abuse protection:** lockout after 5 wrong passwords/PINs (15 min), per-IP and per-account rate limits,
  signup and password-reset responses that never reveal whether an email is registered, and codes stored only as HMACs.
- **Rate limiter:** in memory, so it is per process. Run a single API process, or swap in a shared store
  (e.g. Redis) behind `RateLimiter.hit` before scaling out.
- **Email in development:** `EMAIL_BACKEND=console` prints emails, including codes, to the backend log.
