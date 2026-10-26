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
uv run python -m app.cli sync-games       # create/update the games table from the code registry
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
    schemas.py       InputModel: base for request bodies (unknown fields are rejected)
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
    children/        /api/children: profiles (typed options in options.py) and child sign-in (username + PIN)
    goals/           /api/children/{id}/goals: parent-set targets; readable by anyone who can see the child
    care_team/       parent invites a therapist (/api/children/{id}/therapists); therapist accepts (/api/therapist/links)
    games/           therapy game engine: /api/games, /api/sessions, /api/children/{id}/sessions|levels, /api/audio/noise
      definitions/   one file per game + base.py (the contract); REGISTRY maps slug -> game
      content/       bank.json: the curated, versioned word / minimal-pair / sentence / sound bank
      adaptive.py    level rules (DifficultyStrategy); levels.py, scoring.py, noise.py, catalogue.py
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

## Children, goals and the care team

| Action | Parent | Child (self) | Linked therapist | Admin |
|---|---|---|---|---|
| List / view child profile | own children | self (parent notes hidden) | active links only, each view audited | no |
| Create, edit, delete child; set username + PIN | own children | no | no | no |
| Read goals | yes | yes | yes | no |
| Create, edit, delete goals | yes | no | no | no |
| Invite / remove therapists | yes | no | can decline or leave | no |
| Accept an invitation | no | no | admin-approved therapists | no |

- **Therapist links:** `pending` (invited) → `active` (accepted) → `revoked` (removed by either side). Only
  `active` links give access. A revoked therapist can be invited again.
- **Child sign-in:** usernames are unique across all families (3–30 characters, starting with a letter). PINs are 4–8 digits,
  with obvious ones (1111, 1234, 9876) refused. Changing or removing the login signs the child out everywhere.
- **Goal progress** (`current_value`) is read-only here; it will be computed from game sessions in Phase 6.
- **Deleting a child** permanently removes their sessions, goals, links and progress (database cascade).

## Therapy game engine

**The server owns every session.** `POST /api/sessions {child_id, game}` picks the child's level and
builds every round; the client then sends each **answer** (`{"choice": ...}`, `{"sequence": [...]}` or
`{"transcript": ...}`) to `/rounds/{i}/answer`, and the server says whether it was right. `POST .../complete`
totals accuracy and points and moves the level. Clients never send scores (unknown fields are rejected).

| Game (`slug`) | Skill | What changes with level (1-9) |
|---|---|---|
| `sound-detective` | listening | 2 -> 6 picture options; from level 5 the wrong options are the same kind of sound |
| `similar-sounds` | listening | minimal pairs: easy (cat/hat), medium voicing (pea/bee), hard vowels (bit/beat/bat/bet) |
| `word-sequence` | memory | 2 -> 6 words to repeat in order (partial credit is reported, only exact order counts) |
| `listening-in-noise` | listening | signal-to-noise ratio 20 dB -> 2 dB; white noise, then pink |
| `speech-practice` | speech | short words -> longer words -> sentences; transcript scored 0-100, pass at 75 |

- **Levels:** one per child per skill (listening, speech, memory). Tiers: 1-3 easy, 4-6 medium, 7-9 hard.
- **Adaptive rule** (`RollingThresholdStrategy`): looking at up to the last 3 completed sessions *at the
  current level*: level up when this session and the average are both >= 80% (unless answers were much
  slower than the game's expected time), level down when both are < 60%, otherwise stay. Every change is
  stored in `level_history` with a plain-English reason. Swap the strategy by implementing `DifficultyStrategy`.
- **Points:** 10 per correct round (+10 for a perfect session), x1 / x2 / x3 for easy / medium / hard.
- **One active session per child:** starting a new game abandons an unfinished one. Abandoned sessions
  don't affect levels.
- **Adding a game:** write a `GameDefinition` in `definitions/`, add it to `REGISTRY`, then run
  `python -m app.cli sync-games`.
- **Content:** edit `content/bank.json` (validated on load; bump `version`). Rounds store the exact item
  they used, so bank edits never change past sessions.
- **Noise:** rounds include `{"kind", "snr_db", "url"}`. `/api/audio/noise/{white|pink}.wav` is generated
  at -20 dBFS; play the stimulus at the same level and the noise at gain `10^(-snr_db/20)`.

**Not yet (by design, later phases):**
- **Stimulus audio:** rounds name the stimulus (`text` or `sound_id`). Until Phase 5 serves audio from the server,
  a browser can read the answer from the prompt. Scores are still only computed server-side.
- **Sound effect files:** these are still needed. The old app's MP3s have unknown licences, so they were not copied.
- **Speech Practice transcripts** come from the browser for now (`provider = "browser"` in `speech_attempts`).
  Phase 5 adds server speech-to-text.
- **LLM-generated extra content:** not implemented. The bank is the only source.
