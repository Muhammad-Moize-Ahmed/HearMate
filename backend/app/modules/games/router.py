import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from ...auth.deps import CurrentPrincipal, DbSession
from ...core.deps import AppSettings
from .definitions import GameDefinition
from .noise import NoiseKind, noise_wav
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

games_router = APIRouter(prefix="/games", tags=["games"])
sessions_router = APIRouter(prefix="/sessions", tags=["game sessions"])
child_progress_router = APIRouter(prefix="/children/{child_id}", tags=["game sessions"])
audio_router = APIRouter(prefix="/audio", tags=["audio"])


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


@audio_router.get("/noise/{kind}.wav", response_class=Response)
def get_noise(kind: NoiseKind) -> Response:
    """A short, loopable background-noise clip at -20 dBFS (not personal data; cacheable)."""
    return Response(
        content=noise_wav(kind),
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=86400"},
    )
