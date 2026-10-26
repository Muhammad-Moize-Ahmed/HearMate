import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...auth.policies import get_editable_child, get_viewable_child
from ...auth.principal import Principal
from ...core.audit import record_event
from ...core.errors import NotFoundError
from ...db.models import Child, Goal, GoalStatus
from .schemas import GoalCreateIn, GoalOut, GoalUpdateIn


class GoalsService:
    """Goals belong to a child: anyone who can see the child can read them; the parent edits."""

    def __init__(self, db: Session, principal: Principal, *, client_ip: str | None) -> None:
        self.db = db
        self.principal = principal
        self.client_ip = client_ip

    def list(self, child_id: uuid.UUID, status: GoalStatus | None) -> list[Goal]:
        get_viewable_child(self.db, self.principal, child_id)
        query = select(Goal).where(Goal.child_id == child_id)
        if status is not None:
            query = query.where(Goal.status == status)
        return list(self.db.scalars(query.order_by(Goal.created_at)))

    def create(self, child_id: uuid.UUID, data: GoalCreateIn) -> Goal:
        child = get_editable_child(self.db, self.principal, child_id)
        goal = Goal(child_id=child.id, created_by_id=self.principal.id, **data.model_dump())
        self.db.add(goal)
        self.db.flush()
        self._audit(child, goal, "goal_created")
        self.db.commit()
        return goal

    def update(self, child_id: uuid.UUID, goal_id: uuid.UUID, data: GoalUpdateIn) -> Goal:
        child = get_editable_child(self.db, self.principal, child_id)
        goal = self._goal(child, goal_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(goal, field, value)
        self._audit(child, goal, "goal_updated")
        self.db.commit()
        self.db.refresh(goal)
        return goal

    def delete(self, child_id: uuid.UUID, goal_id: uuid.UUID) -> None:
        child = get_editable_child(self.db, self.principal, child_id)
        goal = self._goal(child, goal_id)
        self._audit(child, goal, "goal_deleted")
        self.db.delete(goal)
        self.db.commit()

    def _goal(self, child: Child, goal_id: uuid.UUID) -> Goal:
        goal = self.db.get(Goal, goal_id)
        if goal is None or goal.child_id != child.id:
            raise NotFoundError("Goal not found")
        return goal

    def _audit(self, child: Child, goal: Goal, action: str) -> None:
        record_event(
            self.db,
            action,
            resource_type="goal",
            resource_id=goal.id,
            actor_user_id=self.principal.id,
            child_id=child.id,
            ip_address=self.client_ip,
        )


def to_goal_out(goal: Goal) -> GoalOut:
    return GoalOut.model_validate(goal, from_attributes=True)
