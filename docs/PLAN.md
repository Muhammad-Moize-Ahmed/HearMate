# HearMate rebuild: analysis and plan

## Context
HearMate (FYP S25BS027, UCP) is being rebuilt from scratch in `new-project/`. The old code in `Hearmate/` is read-only reference. The Phase 1 SRS, Phase 2 SDS, Phase 3 DTS and HearMate.pptx were read. No code will be written until this plan is approved.

Decisions made with the user:
- **Stack:** the same stack, modernised. React + Vite + TypeScript + Tailwind; FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL.
- **Therapists:** real therapist accounts. An admin approves each therapist, and a parent grants or revokes access per child.
- **Payments:** dropped for now. A feature flag leaves room to add subscriptions later.
- **Speech:** server-side STT behind a provider adapter, using faster-whisper by default with Azure as an option. The browser's Web Speech API is the fallback.

---

## 1. What the app does

HearMate is an AI-assisted Progressive Web App that gives auditory-training therapy to children with Auditory Processing Disorder (APD/CAPD). These children hear normally but struggle to tell similar sounds apart, follow spoken instructions and understand speech in noise.

**Main features (from the docs and the code)**
- **Therapy games** in three categories (listening, speech, memory) with Easy, Medium and Hard tiers:
  - Sound Detective: identify animal and environmental sounds.
  - Similar Sound Discrimination.
  - Word Sequence Recognition.
  - Speech Practice: pronunciation scored by STT.
  - Interactive Speech.
  - Story Adventure: AI-generated story.
  - Memory Match, Sequence Master, Rhythm, Word Builder and Sound Matching.
- **Listening-in-noise:** background noise is mixed in at a set signal-to-noise ratio (20, 12 or 8 dB).
- **Adaptive difficulty:** the child goes up a level at ≥80% accuracy, stays between 70 and 80%, and goes down below 70% (the threshold is set to 60 but never used). The level is tracked per child and category, and level history is stored.
- **AI:**
  - Whisper speech-to-text and pronunciation scoring.
  - Azure or gTTS text-to-speech.
  - Gemini for generating words, sentences and stories, and for personalisation.
  - A RandomForest "difficulty predictor". It was trained on **synthetic** data.
- **Gamification:** points, achievements and badges, daily streaks, leaderboards and a celebration animation.
- **Dashboards:**
  - Parent: children, today's and weekly progress, goals.
  - Progress report with charts.
  - Therapist: patients, appointments, assessment.
  - Admin: payment approval.
- **Subscriptions:** a 3-day trial per child, then a manual bank, JazzCash or EasyPaisa transfer with a screenshot that an admin verifies (PKR pricing).
- **PWA and offline use** were promised in every report but were only partly built.

**User roles**

| Role | Docs | Old code |
|---|---|---|
| Child (primary user) | Plays exercises, sees rewards | Logs in with a username and password that the parent creates |
| Parent/Guardian | Signs up, manages children, sets goals, views reports | Email + password or email OTP |
| Therapist/Educator | Detailed reports, customises the learning plan (UC-6, UC-7) | **No real account.** Logs in with the parent's email + the child's username and sees one child |
| Admin | Manages users, maintenance, approves therapists | Only approves payments. The account is created by a script |

## 2. Old tech stack and architecture

**Frontend** (`Hearmate/src`)
- React 19, Vite (rolldown-vite), plain JavaScript, Tailwind 3.
- TanStack Query, axios, React Router 7, framer-motion, Recharts, lucide, vite-plugin-pwa.
- One `AuthContext` that keeps tokens in localStorage.
- One 524-line axios `api.js` service.
- 13 pages and 12 game components, many of them 500–1150 lines (`GamesPage.jsx` is 1150).

**Backend** (`Hearmate/backend/app`)
- FastAPI 0.115, SQLModel, Alembic (14 migrations), PostgreSQL through psycopg3.
- python-jose JWT, passlib/bcrypt, Resend email.
- AI/audio: Gemini (`google-generativeai`), openai-whisper + torch, Azure Speech SDK, gTTS, librosa/pydub, scikit-learn.

**Layout and deployment**
- 17 route modules and about 90 endpoints under `/api`, plus 13 service modules.
- `main.py` wires all the routers together.
- Deployed by hand to a single AWS EC2 instance with shell scripts and nginx.

**Architecture:** a layered client–server design (React SPA → REST → FastAPI → Postgres), with an "AI layer" of service singletons inside the same process.

**Docs vs. code drift**

| Area | Docs | Code |
|---|---|---|
| Frontend framework | Phase 1 names Next.js | React + Vite |
| Database | Phase 1/2 name MySQL, Phase 1 also mentions Firebase | PostgreSQL |
| Therapist sign-up | Phase 3 test case TC-2 tests it | The code forbids it |
| Offline use | A core objective in every phase | Not delivered |

## 3. Weaknesses, bad practices and outdated parts

### Critical (security and privacy, with children's data involved)
1. **Secrets and personal data are committed to git.**
   - `.gitignore` has the `.env` lines commented out, so `.env` and `backend/.env` are tracked.
   - Six real payment screenshots are tracked under `backend/backend/uploads/`.
   - ⚠️ If that repo was ever pushed, **rotate every key in it**: Gemini, Azure, Resend, DB password, JWT secret. I did not open those files.
2. **Therapist login needs no password.** A parent's email plus a child's username is enough to get a token (`routes/auth.py` `therapist_login`).
3. **Privilege confusion.** `get_current_user` turns child and therapist tokens into the **parent's** `User`. A child or therapist token can therefore call any parent endpoint: delete children, verify payments and more.
4. **Payment self-verification.** `POST /payment/verify` lets the parent mark their own payment as verified (the code has a "TODO admin"). That is a free-subscription bypass.
5. **Data exposure across families.** `GET /therapist/search-children` returns every child's name, age and avatar to any logged-in user.
6. **Unauthenticated endpoints that cost money or CPU.** `/ai/speech/tts` and `/ai/speech/recognize` have no auth or rate limit. Anyone can run Azure, Gemini or Whisper on your bill.
7. **OTP and account weaknesses.**
   - OTP codes come from `random.randint`, are stored in plain text, are compared with a plain `!=`, and have no attempt limit or rate limit.
   - `login-request` auto-creates a user with the password `"otp_login_placeholder"`.
   - Password login never checks that the email was verified.
   - The default `SECRET_KEY` is `"change-me"`.
8. **Scores come from the client.** Points are sent by the browser (`PUT /game-sessions/{id}`), so leaderboards and progress can be faked.
9. A public cross-family **leaderboard** of children conflicts with the COPPA and privacy goals stated in the SRS.

### Architecture and code quality
- **Auth is spread out.** Logic is copied across `auth_deps.py`, `therapist.py` and `sessions.py`, which parse token subjects like `"child_12"` and `"therapist_3_12"` and swallow exceptions (`except Exception: pass`).
- **No tests at all.** The Phase 3 report lists 20 "passing" manual test cases.
- **Weak data types.**
  - Dates are stored as ISO **strings** instead of `timestamptz`.
  - JSON columns hold structured data.
  - There are no `ON DELETE` rules.
  - There are also hand-written SQL patch scripts (`create_missing_tables.sql`, `fix_permissions.sql`, `update_schema.py`) next to Alembic, which means schema drift.
- **Duplicate and dead code.**
  - `ai_service.py` and `ai_service_real.py` overlap, as do `speech_service` and `ai_speech_service`.
  - `stripe_webhook.py` and `stripe_service` are never registered in `main.py`.
  - Gemini model selection is a trial-and-error loop.
- **Heavy and fragile dependencies.** openai-whisper + torch in the API process means a multi-GB install, Windows DLL issues and blocking CPU work inside async handlers. The ffmpeg path is hardcoded.
- **Leftover files.** A Windows `venv/` (with .exe files), `.pyc` files, test `.wav` files and a `.pkl` model are in the repo tree. About 156 `print()` calls stand in for logging, and there are 35 `console.log` calls in the frontend.
- **Hardcoded URLs.** `http://localhost:8000` appears inside game components and the admin dashboard. The PWA runtime cache points at `api.heartmate.com`, which is the wrong domain (the package name is also "heartmate").
- **Fragile game wiring.** Games are matched to components by **display-name strings** (`case 'Sound Detective'`). The seeded games reference sound files that don't exist (car, doorbell, bell, drum…).
- **Very large components** mix data fetching, game logic and UI. There are no types between the frontend and the API.
- **Token storage.** Tokens live in localStorage, with no refresh rotation or revocation (logout does nothing).
- **Weak ML.** The "ML model" is trained on synthetic data, so presenting it as AI personalisation is weak academically. A transparent rule-based or statistical adaptive engine is easier to defend.
- **About 15 overlapping deployment and fix markdown files** at the old repo root.

---

## 4. Plan for the new version

### Target structure (`new-project/`)
```
new-project/
  backend/            FastAPI app (uv-managed, Python 3.12)
    app/
      core/           config, security, logging, errors
      db/             engine, base, models/ (one file per aggregate)
      auth/           principals, policies (RBAC), deps
      modules/        children/, therapists/, games/, sessions/, progress/,
                      gamification/, speech/, content/, admin/
                      (each: router.py, schemas.py, service.py, repo.py)
      providers/      stt/ (faster_whisper, azure), tts/, llm/ — adapter interfaces
    alembic/          single fresh baseline migration
    tests/
  frontend/           React + Vite + TS
    src/
      app/            router, providers, layouts per role
      api/            generated OpenAPI types + thin fetch client
      features/       auth/, children/, therapist/, admin/, progress/
      games/          registry.ts + one folder per game (logic hook + UI)
      components/ui/  shared primitives
      lib/            audio, offline queue, utils
  docker-compose.yml  postgres (+ backend/frontend for prod-like run)
  .env.example        (names only, no values) ; .gitignore includes .env*, uploads/, *.wav, venv
  .github/workflows/ci.yml
```

### Phase 0: Foundation
- Create the monorepo layout above, with:
  - A `.gitignore` that covers `.env*`, `venv`, `node_modules`, `uploads`, `*.pkl` and audio files.
  - An `.env.example` that lists variable names with placeholder values only.
- Tooling: uv, ruff and mypy for the backend; pnpm, ESLint, Prettier and `tsc --strict` for the frontend; pre-commit with a secret scanner (gitleaks).
- A Docker Compose file for Postgres, and GitHub Actions CI that runs lint, typecheck and tests for both apps.
- A README covering setup and an architecture overview.

### Phase 1: Backend core
- Config through pydantic-settings. The app refuses to start in production without a real secret.
- SQLAlchemy 2 typed models with `timestamptz`, proper FKs with `ON DELETE CASCADE`, and enums for role and status.
- A single Alembic baseline, structured JSON logging, a consistent error format, and `/health`.
- **Data model:**

| Table(s) | What it holds |
|---|---|
| `users` | Role: parent, therapist or admin. Also `email_verified` and `status` |
| `children` | Profile fields carried over from the old form, plus `username` and a `pin_hash` for child login |
| `therapist_profiles` | Licence and organisation details, approval status |
| `therapist_child_links` | `status`: pending, active or revoked; `granted_by_parent_id` |
| `games` | Stable `slug` and `type` key plus config |
| `game_sessions`, `session_rounds` | Item, expected answer, given answer, correct, response time, noise SNR |
| `speech_attempts` | Speech results |
| `skill_levels` | Per child × category |
| `level_history` | Level changes over time |
| `goals` | Parent goals |
| `learning_plans` | Therapist plan for a child (UC-7) |
| `therapist_notes` | Therapist notes |
| `achievements`, `daily_activity` | Gamification |
| `refresh_tokens` | For rotation and revocation |
| `audit_log` | Who accessed which child's data |

### Phase 2: Authentication and RBAC (fixes items 2–7)
- **One `Principal`** type (`kind`: parent, child, therapist or admin, with an id) is decoded in one place.
- **Policy functions** decide access: `can_view_child`, `can_edit_child` and `can_manage_plan`. Every child-scoped route uses them.
- **Parent accounts:**
  - Sign up, then verify the email with an OTP before the first login.
  - OTPs come from `secrets`, are stored hashed, and allow 5 attempts with rate limiting.
  - Passwords are hashed with argon2 through `pwdlib`.
- **Child login:** the child username plus a PIN set by the parent, with a scope limited to that child.
- **Therapist accounts:** therapists register, an admin approves them, and a parent invites a therapist to a specific child by email. Either side can revoke the link.
- **Tokens:** a short-lived access JWT (PyJWT) and a rotating refresh token in an httpOnly, SameSite cookie. Logout revokes the refresh token.
- Rate limits on auth and AI endpoints (slowapi).

### Phase 3: Children, goals, therapist linking
- Child CRUD for parents, with the profile form the old app had (hearing difficulties, interests and so on) but with typed fields.
- Goals for parents (UC-5).
- Invite, accept and revoke for therapist links.
- Therapists can see only children whose link is active.

### Phase 4: Therapy game engine (fixes item 8)
- **The server owns the session.**
  1. `POST /sessions` starts a session and the server returns the rounds: content and difficulty.
  2. The client sends **answers**, not scores.
  3. The server checks each answer, then computes accuracy and points.
- **Adaptive difficulty** sits behind a strategy interface.
  - The default rule-based strategy reuses the old thresholds: up at ≥80%, down below 60% (the old code used 70% here despite its setting).
  - It also uses a rolling window over the last N sessions, plus response time.
  - This replaces the synthetic-data ML model, and it is easy to explain in the report.
- **Game registry by `slug`.** Start with 5 games done well:
  - Sound Detective.
  - Similar Sound Discrimination.
  - Word Sequence.
  - Listening-in-Noise.
  - Speech Practice.
  The rest are added later through the same registry.
- **Content:** a curated, versioned word, sentence and sound bank (JSON seed). An optional LLM provider generates extra items, which are validated and cached. The app never depends on the LLM to work.
- **Noise:** noise is mixed per round at the SNR for the round's difficulty. Pre-mixing or caching keeps this fast.

### Phase 5: Speech services
- **Interfaces:**
  - `SttProvider.transcribe(audio) -> text, confidence`. Implementations: faster-whisper (default, CPU int8 `base.en`) and Azure (optional).
  - `TtsProvider.synthesize(text) -> audio`, cached on disk by a hash of the text and voice.
- **Pronunciation scoring:** normalise the text, then compute word- and phoneme-level similarity.
- **Audio uploads:** authenticated, size- and duration-limited, transcoded with ffmpeg found on `PATH`.
- Heavy work runs in a worker thread pool (`run_in_threadpool`), so the event loop is never blocked.

### Phase 6: Progress, reports and gamification
- Progress aggregates per child: accuracy by skill and level, trends over time, time practised, streaks. These feed the parent and therapist reports (UC-4, UC-6).
- Achievements and streaks are computed **on the server** when a session completes.
- Leaderboards: replaced with **personal bests and family-only** comparisons, for children's privacy.

### Phase 7: Frontend
- **Foundations:**
  - TS strict, React Router 7, TanStack Query.
  - API types generated from FastAPI's OpenAPI (`openapi-typescript` + `openapi-fetch`).
  - Forms with react-hook-form + zod; Tailwind v4.
  - One layout per role with route guards.
- **Child UI:**
  - Big touch targets and minimal text.
  - Replayable audio for every instruction.
  - Reduced-motion support and accessible colours.
- **Each game** is split into a `useGameLogic` hook (state machine) and presentational components, registered in `games/registry.ts`.
- **Screens:**
  - Landing, Sign up, Verify email, Login (parent, child or therapist tabs).
  - Parent dashboard, Child profile form, Games, Game player, Progress report.
  - Therapist dashboard (patients, notes, learning plan, appointments).
  - Admin (approve therapists, manage users and games).

### Phase 8: PWA and offline use (a stated SRS objective)
- vite-plugin-pwa (Workbox): manifest, icons (placeholders for now) and iOS tags. Precache the app shell and every route chunk, so the app opens offline.
- **Changed when the phase was built:** no answer queue, and no caching of `/api` responses or audio. This protects privacy on shared devices, and scoring stays on the server.
  - Games can't start offline.
  - A game that loses its connection pauses, then picks the session up again from the server when the connection is back.
  - Adult pages refetch by themselves when back online.
- New versions wait for "Refresh", which never interrupts a game. Caches are cleaned on sign-out. Details are in `frontend/README.md`.

### Phase 9: Testing and deployment
- **Backend:** pytest + httpx tests for every policy. Examples:
  - Child A can't read child B.
  - A therapist without an active link gets 403.
  - Unauthenticated calls to the AI endpoints are rejected.
- **Also covered:** the adaptive engine, scoring, and the OTP and refresh flows.
- **Frontend:** Vitest + Testing Library for game logic hooks; Playwright end-to-end tests for these flows:
  - parent sign-up → add child → child plays a game → parent sees progress;
  - therapist invite → therapist views the report.
- **Deployment:**
  - Dockerfiles for both apps and Compose for production.
  - Deploy to a single VM or Render/Railway, with the frontend on Vercel or Netlify.
  - Secrets are set as environment variables on the host only.

### Phase 9b: Account and child deletion (built)
- **Who can delete what.** Parents delete their account (the whole family) or one child. Therapists delete their
  account. Admins can't delete accounts, their own included, and stay read-only (only `/admin/stats` counts change).
  Children can't delete anything.
- **How.** Deletion is immediate and permanent. A warning page lists what goes, then needs "I understand" plus the
  password again. A wrong password is 403 `wrong_password` and uses login's lockout; there are also rate limits per
  account and per IP. Endpoints:
  - `POST /api/account/delete`;
  - `POST /api/children/{id}/delete` (this replaced `DELETE /api/children/{id}`);
  - `GET /api/account/deletion-summary` for the warning page.
- **What goes.**
  - Database cascades remove a family's rows in all 19 tables.
  - A therapist's links and invitations end, but their notes and learning plans stay with the child, shown as
    written by "Former therapist". This needed a migration: `therapist_notes.therapist_id` became nullable, with
    `SET NULL` instead of `CASCADE`. Its downgrade refuses to run while such notes exist.
  - The audit log is cleaned explicitly, because it holds ids as plain strings and IP addresses. A family's rows are
    deleted, leaving one anonymous `account_deleted` event. A deleted therapist's records of seeing or writing about
    a child are kept for the family, with no actor and no IP.
- **Sessions.** Every refresh token is deleted, so every device is signed out at its next request. In the app, the
  goodbye page ends the session, which clears the query cache and Cache Storage (the build precache stays).
- **Emails.** The account holder gets a confirmation; a parent gets one when a child is deleted; linked parents are
  told when their child's therapist leaves. The emails give counts, not children's names. The therapist's name
  appears only in that last email's body and is never stored.
- **Tests.** A family with rows in every table is deleted, then every row of every table is scanned as text: the
  deleted person's ids, email, names, username and IP must appear nowhere, and every table's row count must return
  to where it was.

### Ideas carried over from the old code (re-implemented, nothing copied blindly; no secrets)
- Child-profile field set: `Hearmate/backend/app/db/models.py` (`ChildProfile`).
- Leveling thresholds and noise SNR values: `Hearmate/backend/app/core/config.py` and `app/services/leveling_service.py`.
- Achievement types: `app/services/achievement_service.py`.
- Game catalogue and configs: `backend/seed_games.py`.
- Animal sound files: `Hearmate/public/sounds/*.mp3`. Check their licence before reusing them.
- Game UX ideas: `src/components/games/*`.

### Suggested build order and milestones
1. Phases 0–2: a repo where you can sign up, log in and see role-based access working, with tests in CI.
2. Phases 3–4: parent → child → play one game end-to-end, with scores computed on the server.
3. Phases 5–6: speech practice working, and progress reports.
4. Phase 7: polish every screen.
5. Phase 8: offline use.
6. Phase 9: deployment.

Commit after each phase on a feature branch, then open a PR to `main`.

## Verification
- `docker compose up db`, then `uv run alembic upgrade head`, then `uv run pytest` must pass, including the authorization matrix tests.
- `pnpm typecheck && pnpm test && pnpm build` in `frontend/`; Playwright end-to-end tests against the local stack.
- Manual walkthrough as each role:
  - parent: sign up and verify email;
  - child: start Sound Detective, go offline mid-round (the game pauses), go back online and finish it;
  - therapist: view the report only after the parent grants access;
  - admin: approve a therapist.
- Security checks:
  - gitleaks finds nothing.
  - Calls to `/speech/*` without a token return 401.
  - Changing the score in the request body has no effect.
