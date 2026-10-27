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
uv run python -m app.cli check-sounds     # Sound Detective files in SOUNDS_DIR: what each sound plays (read-only)
uv run python -m app.cli speech-setup     # download speech models (outside the repo) + self-test
uv run python -m app.cli export-openapi --output ../frontend/src/api/openapi.json   # API schema (or: pnpm gen:api)
HEARMATE_SPEECH_MODELS=1 uv run pytest tests/test_speech_models.py   # real-model round trips
```

ffmpeg must be on `PATH` (`brew install ffmpeg` / `apt-get install ffmpeg`).

## Layout

```
app/
  main.py            app factory: middleware, error handlers, routers, app.state
  cli.py             operator commands (create-admin, sync-games, check-sounds, speech-setup, export-openapi)
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
    speech/          SttProvider (Whisper, Azure) and TtsProvider (Piper, Azure) interfaces,
                     TTS disk cache, ffmpeg decoding and noise mixing (audio.py)
  db/
    base.py          declarative Base, constraint naming, UUID/timestamp mixins, str_enum()
    session.py       engine, sessionmaker, get_db dependency
    models/          one module per area (users, children, therapists, games, progress, ...)
  modules/
    health/          GET /api/health (liveness), GET /api/health/ready (database check)
    auth/            /api/auth/*: signup, verify-email, login, child-login, refresh, logout, password reset, me
    admin/           /api/admin/therapists: list, approve, reject; /api/admin/users and /stats (read-only)
    children/        /api/children: profiles (typed options in options.py) and child sign-in (username + PIN)
    goals/           /api/children/{id}/goals: parent-set targets; readable by anyone who can see the child
    care_team/       parent invites a therapist (/api/children/{id}/therapists); therapist accepts (/api/therapist/links)
    notes/           /api/children/{id}/notes: therapist notes; linked therapists write, the parent reads
    learning_plans/  /api/children/{id}/learning-plans: the therapist's practice plan (UC-7), one active per child
    progress/        progress, reports and gamification: /api/children/{id}/progress|progress/trend|report|
                     achievements|personal-bests, /api/family/progress (recorder.py runs on session completion)
    games/           therapy game engine: /api/games, /api/sessions, /api/children/{id}/sessions|levels, /api/speech/status
      definitions/   one file per game + base.py (the contract); REGISTRY maps slug -> game
      content/       bank.json: the curated, versioned word / minimal-pair / sentence / sound bank
      adaptive.py    level rules (DifficultyStrategy); levels.py, scoring.py, noise.py, catalogue.py
      pronunciation.py  word- and phoneme-level scoring (CMU dictionary)
      sounds.py      Sound Detective files: any format via ffmpeg, trimmed, cached in memory
      stimulus.py    renders a round's audio: TTS / sound file + background noise
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
- **Child data:** route handlers must load children through `get_viewable_child`, `get_editable_child`,
  `get_plan_readable_child` or `get_plan_managed_child`. A caller who can't see a child gets 404, so IDs reveal
  nothing. Admins have no access to children's therapy data.
- **Abuse protection:** lockout after 5 wrong passwords/PINs (15 min), per-IP and per-account rate limits,
  signup and password-reset responses that never reveal whether an email is registered, and codes stored only as HMACs.
- **Admin API:** admins only (others get 401/403), with one shared budget of 120 requests a minute per admin
  account across every `/api/admin` route. Read-only views:
  - `GET /admin/users?q=&role=&status=&limit=25&offset=0`: parents, therapists and admins, newest first, with
    `total` for paging. `q` matches part of an email or name (case-insensitive; `%` and `_` match literally).
    Each row has the account status, whether the email is verified, the therapist's approval status, and for
    parents only a `children_count`.
  - `GET /admin/stats`: counts of parents, therapists by approval status, admins, turned-off accounts, children,
    and games completed in the last 7 and 30 days.

  Children are never listed: no names, usernames, PINs or profile details, only counts. Nothing here edits,
  deletes, impersonates or changes roles.
- **Rejected therapists** see the admin's reason in `/auth/me` (`therapist_rejection_reason`); it is cleared
  when they are approved.
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
| Read therapist notes and learning plans | yes | no | yes, each read audited | no |
| Write therapist notes and learning plans | no | no | yes (notes: edit and delete only their own) | no |

- **Therapist links:** `pending` (invited) → `active` (accepted) → `revoked` (removed by either side). Only
  `active` links give access. A revoked therapist can be invited again.
- **Child sign-in:** usernames are unique across all families (3–30 characters, starting with a letter). PINs are 4–8 digits,
  with obvious ones (1111, 1234, 9876) refused. Changing or removing the login signs the child out everywhere.
- **Goal progress** (`current_value`) is read-only here; it will be computed from game sessions in Phase 6.
- **Deleting a child** permanently removes their sessions, goals, links, progress, notes and learning plans
  (database cascade).

## Therapist notes and learning plans

Written by therapists with an **active link** and an **admin-approved** account; read by the **parent** and those
therapists. The child can't read them (403), because notes are clinical and written for adults. Everyone else gets
404. Every write is audit-logged, and so is every therapist read.

| Endpoint (`/api/children/{id}/...`) | Who | What |
|---|---|---|
| `GET notes?limit=50&before=...` | parent, linked therapist | newest first; for the next page pass the oldest `created_at` you have as `before` |
| `POST notes` `{body}` | linked therapist | write a note (1–5,000 characters) |
| `PATCH notes/{note_id}` `{body}`, `DELETE notes/{note_id}` | the note's author | change or delete your own note; anyone else gets 403 `not_note_author` |
| `GET learning-plans?active=true\|false` | parent, linked therapist | the active plan first, then archived ones, newest first |
| `GET learning-plans/active` | same | the plan in use now; 404 `no_active_plan` if there isn't one |
| `GET learning-plans/{plan_id}` | same | one plan, active or archived |
| `POST learning-plans` `{title, notes?, items?}` | linked therapist | start a new plan; it becomes active and the previous plan is archived |
| `PATCH learning-plans/{plan_id}` | linked therapist | change the active plan's `title`, `notes` or `items` (`items` replaces the whole list) |
| `POST learning-plans/{plan_id}/archive` | linked therapist | end the active plan without starting a new one |

- **Notes:** only the author can change or delete a note. When a therapist's link is removed, they lose access, but
  their notes stay visible to the parent.
- **One active plan per child.** Any linked therapist can edit it (it is the child's shared plan; `created_by` shows
  who started it). Archived plans are kept unchanged as history: changing one gives 409 `plan_archived`. Plans are
  archived, never deleted. If two therapists start a plan at the same moment, one gets 409 `plan_changed`.
- **Plan items:** `{game, sessions_per_week, difficulty?, notes?}`, where `game` is a game slug. The game must be in
  the catalogue and active (otherwise 404 `game_not_found` with the unknown slugs in `details`). Each game appears at
  most once, with at most 20 items and 1–21 sessions per week. Items come back in catalogue order with the game's slug,
  title and category.
- **`difficulty`** (`easy` / `medium` / `hard`) is the therapist's suggestion only. The child's level is still set by the
  adaptive engine.

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
- **Stimulus audio is rendered on the server.** Each prompt has `stimulus: {type, audio_url}`; the word, words
  or sound itself stays in the private `session_rounds.stimulus` column, so the answer isn't in the prompt.
  `GET .../rounds/{i}/stimulus` returns WAV (16 kHz mono) with any background noise already mixed in at the
  round's signal-to-noise ratio (`prompt.noise = {kind, snr_db}` is for display only). It needs the bearer token:
  fetch it, then play a blob URL.
- **Round shapes are published.** `prompt` (`PromptOut`), `given_answer`, `correct_answer` and `feedback` have
  OpenAPI schemas, so the frontend uses generated types. A field a game doesn't use is left out of the JSON, not sent
  as null. Word Sequence prompts include `answer_length` (how many words to tap). `GET /api/speech/status` is
  typed too (`SpeechStatusOut`).
- **Not included:** sound-effect files for Sound Detective (the other four games use the TTS voice and generated
  noise). Put licensed files (e.g. CC0) in `SOUNDS_DIR` (e.g. `SOUNDS_DIR=~/.cache/hearmate/sounds` in `.env`; a leading
  `~` is expanded in settings, as for `PIPER_VOICE_DIR` and `TTS_CACHE_DIR`),
  named `<sound_id>.<ext>`, using the 24 ids in `content/bank.json` (`dog`, `cat`, `cow`, `duck`, `lion`,
  `frog`, `bird`, `car_horn`, `train`, `airplane`, `bicycle_bell`, `ambulance`, `doorbell`, `phone`, `clock`, `vacuum`,
  `tap`, `rain`, `thunder`, `wind`, `drum`, `piano`, `guitar`, `bell`). The old app's MP3s have unknown licences, so
  they were not copied. How the files are used (`games/sounds.py`):
  - **Formats:** `.wav` at any bit depth (8/16/24/32-bit integer, 32-bit float), `.flac`, `.aiff`, `.m4a`/AAC,
    `.mp3` and `.ogg`; any sample rate; mono or stereo. Other extensions are ignored. Each file is decoded to the
    game engine's format: 16 kHz, mono, 16-bit. The files themselves are never changed.
  - **Trimming, never rejecting:** leading silence (quieter than -50 dBFS) is skipped, keeping 100 ms before the
    sound starts, then the first **4 s** are kept (`MAX_CLIP_SECONDS`), with a 100 ms fade-out where a clip was
    cut. Shorter files are used whole. 4 s is two or three cycles of a sound that repeats (barks, a clock's ticks,
    a ringing phone), which is what makes it recognisable, while a round stays short for a child and quick to
    replay; noisy rounds add 0.4 s of noise before and after. Long recordings are fine: `-t` is an ffmpeg output
    option, so ffmpeg stops reading after 4 s of sound, and a 6-minute, 100 MB file decodes in about 35 ms, the
    same as a short one.
  - **Not the upload rules:** library files go through `decode_file`, children's recordings through `decode`.
    Recordings keep their own limit (`SPEECH_MAX_SECONDS`, 15 s) and errors (422 `audio_too_long`, "Recordings can
    be at most 15 seconds"). A library file that can't be decoded raises `AudioFileError`, which is logged for the
    operator and never sent to a client.
  - **Cache:** every bank sound is decoded once at startup (in parallel; about 0.25 s and 3 MB for all 24) and kept
    in memory. A file added or replaced later is decoded on its first use.
  - **Skipped:** hidden files (`.DS_Store`, `._dog.wav`). A file that can't be decoded is skipped with a warning
    naming it (logged once); another file for the same sound (e.g. `dog.mp3` next to a broken `dog.wav`) is used if
    there is one. With two files for one sound, `.wav` wins over `.flac`, `.aiff`, `.m4a`, `.mp3`, `.ogg`.
  - A sound with no usable file makes its rounds return 503 `sound_unavailable`; the app says the sound isn't ready
    and offers another game (the session is abandoned, so levels aren't affected). The startup log lists bank sounds
    that have no file.
  - **Checking a folder:** `uv run python -m app.cli check-sounds` (or `--dir <folder>`) lists every sound id with the
    file used, the decoded clip length, whether it was trimmed, and any problem: no file, a file that can't be
    decoded (with ffmpeg's reason), a second file that isn't used, or a file whose name matches no sound id. It
    only reads the files. It exits with 1 unless every sound is ready.
- **Not included:** LLM-generated extra content. The bank is the only source.

## Speech services

| | Default (local, free) | Optional |
|---|---|---|
| Speech-to-text | faster-whisper `base.en`, CPU int8 (`STT_PROVIDER=whisper`) | Azure (`azure`), or `none` |
| Text-to-speech | Piper `en_US-lessac-medium` (`TTS_PROVIDER=piper`) | Azure (`azure`, voice `en-IN-NeerjaNeural`), or `none` |

- **Models live outside the repo:**
  - the Piper voice is in `~/.cache/hearmate/piper`;
  - Whisper is in the Hugging Face cache (`~/.cache/huggingface`);
  - generated speech is cached in `~/.cache/hearmate/tts`, keyed by voice and text.

  Download the models with `python -m app.cli speech-setup`. The models load lazily on first use, and `.gitignore`
  also blocks model files as a safety net.
- **Spoken answers:** `POST /api/sessions/{id}/rounds/{i}/speech?response_time_ms=...` with the raw recording as the
  body (`Content-Type: audio/webm`, `audio/ogg`, `audio/mp4`, `audio/wav`, ...).
  - **Limits:** at most 2 MB, enforced while streaming, so oversized uploads are cut off early; at most 15 s;
    30 uploads per minute per account.
  - **Pipeline:** ffmpeg decodes the recording (pipe input only, audio containers only), Whisper transcribes it in
    a worker thread (2 at a time by default), then it is scored word by word and sound by sound.
  - **Privacy:** recordings are not stored; only the transcript and scores are kept (`speech_attempts`).
  - **Ordering:** permissions and round state are checked before the slow transcription runs.
- **Pronunciation scoring:** each word is compared through its sounds (ARPAbet phonemes from the CMU dictionary).
  The feedback lists per-word scores and the `practise_sounds` a child missed most (e.g. `TH` for "three" -> "tree").
  A round passes at 75/100.
- **Browser fallback:** `GET /api/speech/status` says whether server STT/TTS are set up. A browser transcript can
  still be sent to the normal `/answer` endpoint, and is stored with `provider = "browser"`.

## Progress, reports and gamification

**Recorded on the server when a session completes**, in the same transaction:
- **daily activity** (sessions, points, time practised) on the child's *local* date;
- the **streak**;
- **achievements**;
- **goal progress**.

The `/complete` response includes `streak_days`, `new_achievements` and `goals_achieved`, so the app can celebrate
straight away. Abandoned sessions don't count.

- **Local days:** each child has an optional `timezone` (IANA name, set with `PATCH /api/children/{id}`).
  Without one, `DEFAULT_TIMEZONE` (`Asia/Karachi`) is used, so a game at 11:30 pm counts for that evening.
- **Streak:** consecutive local days with a completed session. It stays alive until the end of the next day.
- **Achievements:** 13 badges defined in code (`progress/achievements.py`). They are unlocked once each and based
  only on the child's own progress (first game, perfect game, level up, 3/7/30-day streaks, every game played,
  1,000 points, and so on).
- **Goals:** `current_value` is recomputed (not incremented), so it can't drift. It counts the completed sessions in
  the goal's skill (or any skill), from the moment the goal was created to the end of its due date. A goal is marked
  `achieved` when it reaches its target.

| Endpoint (`/api/...`) | Who | What |
|---|---|---|
| `children/{id}/progress?days=30` | anyone who can see the child | totals (all time and period), streaks, level + accuracy + trend per skill, recent level changes, active goals |
| `children/{id}/progress/trend?days=30` | same | one point per local day, for charts: totals, average accuracy, `games` (sessions and accuracy per game that day) and `levels` (the level in each skill at the end of the day) |
| `children/{id}/report?days=30` | parent, linked therapist (audited) | the above, plus per-game results, **accuracy by noise level** (quiet / moderate / loud), **speech sounds to practise**, **hardest minimal-pair contrasts**, level changes |
| `children/{id}/achievements` | anyone who can see the child | the full badge list, with unlock dates |
| `children/{id}/personal-bests` | same | best accuracy, points and level per game |
| `family/progress` | parent, or a child (their siblings) | this week, side by side, siblings only |

**Periods:** `days` (7-365) counts back from `end`, an optional date that defaults to the child's today (a later
date is treated as today), so `?days=14&end=2026-10-14` covers 1-14 October. Streaks are always as of today.

**No leaderboards across families:** children compete with their own personal bests, and the only comparison is
between siblings. Therapist views of progress and reports are written to the audit log.
