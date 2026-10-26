import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from ...auth.deps import CurrentPrincipal, DbSession, ParentPrincipal
from ...core.deps import ClientIp
from ...db.models import GoalStatus
from .schemas import GoalCreateIn, GoalOut, GoalUpdateIn
from .service import GoalsService, to_goal_out

router = APIRouter(prefix="/children/{child_id}/goals", tags=["goals"])


def get_goals_service(db: DbSession, principal: CurrentPrincipal, ip: ClientIp) -> GoalsService:
    return GoalsService(db, principal, client_ip=ip)


def get_parent_goals_service(
    db: DbSession, principal: ParentPrincipal, ip: ClientIp
) -> GoalsService:
    return GoalsService(db, principal, client_ip=ip)


Service = Annotated[GoalsService, Depends(get_goals_service)]
ParentService = Annotated[GoalsService, Depends(get_parent_goals_service)]


@router.get("")
def list_goals(
    child_id: uuid.UUID,
    service: Service,
    status: Annotated[GoalStatus | None, Query()] = None,
) -> list[GoalOut]:
    return [to_goal_out(g) for g in service.list(child_id, status)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_goal(child_id: uuid.UUID, body: GoalCreateIn, service: ParentService) -> GoalOut:
    return to_goal_out(service.create(child_id, body))


@router.patch("/{goal_id}")
def update_goal(
    child_id: uuid.UUID, goal_id: uuid.UUID, body: GoalUpdateIn, service: ParentService
) -> GoalOut:
    return to_goal_out(service.update(child_id, goal_id, body))


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(child_id: uuid.UUID, goal_id: uuid.UUID, service: ParentService) -> None:
    service.delete(child_id, goal_id)
