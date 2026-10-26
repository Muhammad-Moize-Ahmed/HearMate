# HearMate backend

FastAPI service for HearMate. See the root `README.md` for full setup and [../docs/PLAN.md](../docs/PLAN.md) for the roadmap.

```bash
uv sync                                   # install deps into .venv
uv run alembic upgrade head               # apply migrations (needs: docker compose up -d db)
uv run uvicorn app.main:app --reload      # http://localhost:8000/api/docs
uv run pytest                             # all tests (DB tests use a separate <db>_test database)
uv run pytest -m "not db"                 # only tests that don't need PostgreSQL
uv run ruff check . && uv run ruff format --check . && uv run mypy
```

## Layout

```
app/
  main.py            app factory: middleware, error handlers, routers
  core/
    config.py        settings from env / .env (pydantic-settings); production safety checks
    logging.py       JSON or console logs, each line tagged with the request ID
    middleware.py    request ID (X-Request-ID), one access-log line per request, crash -> JSON 500
    errors.py        AppError hierarchy and the single error response shape
  db/
    base.py          declarative Base, constraint naming, UUID/timestamp mixins, str_enum()
    session.py       engine, sessionmaker, get_db dependency
    models/          one module per area (users, children, therapists, games, progress, ...)
  modules/
    health/          GET /api/health (liveness), GET /api/health/ready (database check)
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
