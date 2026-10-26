import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from ...auth.deps import CurrentPrincipal, DbSession
from ...core.deps import ClientIp
from .schemas import LearningPlanOut, PlanCreateIn, PlanUpdateIn
from .service import LearningPlansService

router = APIRouter(prefix="/children/{child_id}/learning-plans", tags=["learning plans"])


def get_service(db: DbSession, principal: CurrentPrincipal, ip: ClientIp) -> LearningPlansService:
    return LearningPlansService(db, principal, client_ip=ip)


Service = Annotated[LearningPlansService, Depends(get_service)]


@router.get("")
def list_plans(
    child_id: uuid.UUID,
    service: Service,
    active: Annotated[bool | None, Query(description="Only the active or archived plans")] = None,
) -> list[LearningPlanOut]:
    """The child's learning plans: the active one first, then the archived ones, newest first."""
    return service.list_plans(child_id, active)


@router.get("/active")
def get_active_plan(child_id: uuid.UUID, service: Service) -> LearningPlanOut:
    """The plan in use now; 404 `no_active_plan` if there isn't one."""
    return service.get_active(child_id)


@router.get("/{plan_id}")
def get_plan(child_id: uuid.UUID, plan_id: uuid.UUID, service: Service) -> LearningPlanOut:
    return service.get(child_id, plan_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_plan(child_id: uuid.UUID, body: PlanCreateIn, service: Service) -> LearningPlanOut:
    """Start a new plan (approved, linked therapists only). It replaces the active plan,
    which is archived."""
    return service.create(child_id, body)


@router.patch("/{plan_id}")
def update_plan(
    child_id: uuid.UUID, plan_id: uuid.UUID, body: PlanUpdateIn, service: Service
) -> LearningPlanOut:
    """Change the active plan. `items`, when sent, replaces the whole list."""
    return service.update(child_id, plan_id, body)


@router.post("/{plan_id}/archive")
def archive_plan(child_id: uuid.UUID, plan_id: uuid.UUID, service: Service) -> LearningPlanOut:
    """End the active plan without starting a new one."""
    return service.archive(child_id, plan_id)
