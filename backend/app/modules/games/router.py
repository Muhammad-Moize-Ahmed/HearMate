import uuid
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from starlette.concurrency import run_in_threadpool

from ...auth.deps import CurrentPrincipal, DbSession
from ...core.deps import AppSettings, Limiter, Speech
from ...core.errors import AppError
from .definitions import GameDefinition
from .schemas import (
    AnswerIn,
    AnswerOut,
    GameOut,
    SessionOut,
    SessionSummaryOut,
    SkillLevelOut,
    Slug,
    StartSessionIn,
)
from .service import GameSessionService
from .stimulus import render_stimulus

games_router = APIRouter(prefix="/games", tags=["games"])
sessions_router = APIRouter(prefix="/sessions", tags=["game sessions"])
child_progress_router = APIRouter(prefix="/children/{child_id}", tags=["game sessions"])
speech_router = APIRouter(prefix="/speech", tags=["speech"])

# What browsers' MediaRecorder produces, plus common file types. ffmpeg checks the real format.
AUDIO_CONTENT_TYPES = frozenset(
    {
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "audio/mpeg",
    }
)


class AudioTooLargeError(AppError):
    status_code = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    code = "audio_too_large"


class UnsupportedAudioError(AppError):
    status_code = HTTPStatus.UNSUPPORTED_MEDIA_TYPE
    code = "unsupported_audio"


def get_service(
    db: DbSession, principal: CurrentPrincipal, settings: AppSettings
) -> GameSessionService:
    return GameSessionService(db, principal, settings=settings)


Service = Annotated[GameSessionService, Depends(get_service)]
RoundIndex = Annotated[int, Path(ge=0, le=100)]


def _game_out(definition: GameDefinition) -> GameOut:
    return GameOut(
        slug=definition.slug,
        title=definition.title,
        description=definition.description,
        category=definition.category,
        icon=definition.icon,
        rounds_per_session=definition.rounds_per_session,
        requires_microphone=definition.requires_microphone,
        supports_noise=definition.supports_noise,
        always_noise=definition.always_noise,
    )


@games_router.get("")
def list_games(service: Service) -> list[GameOut]:
    """The active game catalogue."""
    return [_game_out(d) for d in service.catalogue()]


@sessions_router.post("", status_code=status.HTTP_201_CREATED)
def start_session(body: StartSessionIn, service: Service) -> SessionOut:
    """Start a game for a child. The server picks the level and builds every round.

    Starting a new session ends (abandons) any unfinished one for the same child.
    """
    return service.start(body)


@sessions_router.get("/{session_id}")
def get_session(session_id: uuid.UUID, service: Service) -> SessionOut:
    return service.get(session_id)


@sessions_router.post("/{session_id}/rounds/{index}/answer")
def answer_round(
    session_id: uuid.UUID, index: RoundIndex, body: AnswerIn, service: Service
) -> AnswerOut:
    """Send the child's answer; the server says whether it was right. Each round once."""
    return service.answer(session_id, index, body)


@sessions_router.post("/{session_id}/complete")
def complete_session(session_id: uuid.UUID, service: Service) -> SessionOut:
    """Finish after every round is answered: totals, points and the level decision."""
    return service.complete(session_id)


@sessions_router.post("/{session_id}/abandon")
def abandon_session(session_id: uuid.UUID, service: Service) -> SessionOut:
    """Stop early. Abandoned sessions don't count towards levels."""
    return service.abandon(session_id)


@sessions_router.get(
    "/{session_id}/rounds/{index}/stimulus",
    response_class=Response,
    responses={200: {"content": {"audio/wav": {}}}},
)
def get_stimulus(
    session_id: uuid.UUID,
    index: RoundIndex,
    service: Service,
    speech: Speech,
    settings: AppSettings,
) -> Response:
    """The round's audio (word, words or sound, with any background noise mixed in) as WAV.

    Needs the bearer token, so fetch it and play it from a blob URL.
    """
    stimulus = service.stimulus(session_id, index)
    audio = render_stimulus(stimulus.content, stimulus.noise, speech, settings.SOUNDS_DIR)
    return Response(
        audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"}
    )


@sessions_router.post(
    "/{session_id}/rounds/{index}/speech",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                t: {"schema": {"type": "string", "format": "binary"}} for t in AUDIO_CONTENT_TYPES
            },
        }
    },
)
async def answer_with_speech(
    session_id: uuid.UUID,
    index: RoundIndex,
    request: Request,
    service: Service,
    speech: Speech,
    settings: AppSettings,
    limiter: Limiter,
    principal: CurrentPrincipal,
    response_time_ms: Annotated[int | None, Query(ge=0, le=600_000)] = None,
) -> AnswerOut:
    """Answer a speech round with a recording: the raw audio is the request body
    (e.g. `Content-Type: audio/webm`). The server transcribes and scores it; audio isn't kept."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in AUDIO_CONTENT_TYPES:
        raise UnsupportedAudioError("Send the recording as audio (e.g. audio/webm)")
    limiter.hit(f"speech:{principal.id}", limit=30, window_seconds=60)
    audio = await _read_limited(request, settings.SPEECH_MAX_UPLOAD_BYTES)
    # Decoding and speech recognition are CPU-heavy: keep them off the event loop.
    return await run_in_threadpool(
        service.answer_speech, session_id, index, audio, response_time_ms, speech
    )


async def _read_limited(request: Request, max_bytes: int) -> bytes:
    """Read the body, stopping as soon as it's too big (works for chunked uploads too)."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > max_bytes:
        raise AudioTooLargeError(f"Recordings can be at most {max_bytes // 1000} kB")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise AudioTooLargeError(f"Recordings can be at most {max_bytes // 1000} kB")
        chunks.append(chunk)
    return b"".join(chunks)


@speech_router.get("/status")
def speech_status(speech: Speech, _: CurrentPrincipal) -> dict[str, Any]:
    """Whether server speech recognition and speech audio are set up (so the app can fall
    back to the browser's own speech features if not)."""
    return speech.status()


@child_progress_router.get("/sessions")
def list_child_sessions(
    child_id: uuid.UUID,
    service: Service,
    game: Annotated[Slug | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[SessionSummaryOut]:
    """The child's sessions, newest first."""
    return service.history(child_id, game=game, limit=limit)


@child_progress_router.get("/levels")
def get_child_levels(child_id: uuid.UUID, service: Service) -> list[SkillLevelOut]:
    """Current level (1-9) per skill category."""
    return service.levels(child_id)
