import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ...auth.deps import CurrentPrincipal, DbSession
from ...core.deps import AppSettings
from .schemas import (
    AchievementOut,
    ChildReportOut,
    DayOut,
    FamilyMemberOut,
    PersonalBestOut,
    ProgressSummaryOut,
)
from .service import ProgressService

progress_router = APIRouter(prefix="/children/{child_id}", tags=["progress"])
family_router = APIRouter(prefix="/family", tags=["progress"])

Days = Annotated[int, Query(ge=7, le=365, description="Length of the period, in the child's days")]
End = Annotated[
    date | None,
    Query(description="Last day of the period (the child's today when left out or later)"),
]


def get_service(
    db: DbSession, principal: CurrentPrincipal, settings: AppSettings
) -> ProgressService:
    return ProgressService(db, principal, settings=settings)


Service = Annotated[ProgressService, Depends(get_service)]


@progress_router.get("/progress")
def get_progress(
    child_id: uuid.UUID, service: Service, days: Days = 30, end: End = None
) -> ProgressSummaryOut:
    """Totals, streaks, levels and accuracy per skill, recent level changes and active goals."""
    return service.summary(child_id, days, end)


@progress_router.get("/progress/trend")
def get_progress_trend(
    child_id: uuid.UUID, service: Service, days: Days = 30, end: End = None
) -> list[DayOut]:
    """One point per day for charts (days without play are zeros)."""
    return service.trend(child_id, days, end)


@progress_router.get("/report")
def get_report(
    child_id: uuid.UUID, service: Service, days: Days = 30, end: End = None
) -> ChildReportOut:
    """Detailed report for parents and linked therapists: per game, accuracy by noise level,
    speech sounds to practise and the hardest sound contrasts."""
    return service.report(child_id, days, end)


@progress_router.get("/achievements")
def get_achievements(child_id: uuid.UUID, service: Service) -> list[AchievementOut]:
    """Every badge, with `unlocked_at` set for those earned."""
    return service.achievements(child_id)


@progress_router.get("/personal-bests")
def get_personal_bests(child_id: uuid.UUID, service: Service) -> list[PersonalBestOut]:
    """Best results per game: the child competes only with themselves."""
    return service.personal_bests(child_id)


@family_router.get("/progress")
def get_family_progress(service: Service) -> list[FamilyMemberOut]:
    """Siblings' week side by side: parents see their children, a child sees their siblings."""
    return service.family()
