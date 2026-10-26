import uuid
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.policies import get_plan_managed_child, get_plan_readable_child
from ...auth.principal import Principal, PrincipalKind
from ...core.audit import record_event
from ...core.errors import ConflictError, NotFoundError
from ...db.models import Child, Game, LearningPlan, LearningPlanItem, User
from ..games.schemas import SessionGameOut
from ..notes.schemas import AuthorOut
from .schemas import LearningPlanOut, PlanCreateIn, PlanItemIn, PlanItemOut, PlanUpdateIn


class LearningPlansService:
    """A therapist's practice plan for a child (UC-7).

    Any linked, approved therapist can write or change the child's plan; the parent reads it.
    A child has at most one active plan: creating a new one archives the old one, and
    archived plans are kept, unchanged, as history.
    """

    def __init__(self, db: Session, principal: Principal, *, client_ip: str | None) -> None:
        self.db = db
        self.principal = principal
        self.client_ip = client_ip

    # ------------------------------------------------------------------ reading

    def list_plans(self, child_id: uuid.UUID, active: bool | None) -> list[LearningPlanOut]:
        """The active plan first, then archived plans, newest first."""
        child = get_plan_readable_child(self.db, self.principal, child_id)
        query = select(LearningPlan).where(LearningPlan.child_id == child.id)
        if active is not None:
            query = query.where(LearningPlan.is_active.is_(active))
        plans = list(
            self.db.scalars(
                query.order_by(LearningPlan.is_active.desc(), LearningPlan.created_at.desc())
            )
        )
        result = self._out(plans)
        self._audit_therapist_view(child)
        return result

    def get(self, child_id: uuid.UUID, plan_id: uuid.UUID) -> LearningPlanOut:
        child = get_plan_readable_child(self.db, self.principal, child_id)
        (result,) = self._out([self._plan(child, plan_id)])
        self._audit_therapist_view(child)
        return result

    def get_active(self, child_id: uuid.UUID) -> LearningPlanOut:
        child = get_plan_readable_child(self.db, self.principal, child_id)
        plan = self.db.scalar(
            select(LearningPlan).where(LearningPlan.child_id == child.id, LearningPlan.is_active)
        )
        if plan is None:
            raise NotFoundError("This child has no active learning plan", code="no_active_plan")
        (result,) = self._out([plan])
        self._audit_therapist_view(child)
        return result

    # ------------------------------------------------------------------ writing

    def create(self, child_id: uuid.UUID, data: PlanCreateIn) -> LearningPlanOut:
        """Start a new plan. It becomes the active one; the previous plan is archived."""
        child = get_plan_managed_child(self.db, self.principal, child_id)
        games = self._games(data.items)
        replaced = self.db.scalar(
            update(LearningPlan)
            .where(LearningPlan.child_id == child.id, LearningPlan.is_active)
            .values(is_active=False)
            .returning(LearningPlan.id)
        )
        plan = LearningPlan(
            child_id=child.id,
            created_by_id=self.principal.id,
            title=data.title,
            notes=data.notes,
            is_active=True,
            # App clock: now() is fixed per transaction, so plans would tie when sorted.
            created_at=datetime.now(UTC),
        )
        self.db.add(plan)
        try:
            self.db.flush()
        except IntegrityError as exc:  # another therapist started a plan at the same moment
            self.db.rollback()
            raise ConflictError(
                "The learning plan was just changed by someone else. Reload and try again.",
                code="plan_changed",
            ) from exc
        self._add_items(plan, data.items, games)
        self._audit(
            child,
            plan,
            "learning_plan_created",
            details={"replaced_plan_id": str(replaced)} if replaced else None,
        )
        self.db.commit()
        (result,) = self._out([plan])
        return result

    def update(
        self, child_id: uuid.UUID, plan_id: uuid.UUID, data: PlanUpdateIn
    ) -> LearningPlanOut:
        child = get_plan_managed_child(self.db, self.principal, child_id)
        plan = self._active_plan(child, plan_id)
        changes = data.model_dump(exclude_unset=True, exclude={"items"})
        for field, value in changes.items():
            setattr(plan, field, value)
        if data.items is not None:
            games = self._games(data.items)
            self.db.execute(delete(LearningPlanItem).where(LearningPlanItem.plan_id == plan.id))
            self._add_items(plan, data.items, games)
        fields = sorted(data.model_fields_set)
        self._audit(child, plan, "learning_plan_updated", details={"fields": fields})
        self.db.commit()
        self.db.refresh(plan)
        (result,) = self._out([plan])
        return result

    def archive(self, child_id: uuid.UUID, plan_id: uuid.UUID) -> LearningPlanOut:
        """End the active plan without starting a new one."""
        child = get_plan_managed_child(self.db, self.principal, child_id)
        plan = self._active_plan(child, plan_id)
        plan.is_active = False
        self._audit(child, plan, "learning_plan_archived")
        self.db.commit()
        self.db.refresh(plan)
        (result,) = self._out([plan])
        return result

    # ------------------------------------------------------------------ helpers

    def _plan(self, child: Child, plan_id: uuid.UUID) -> LearningPlan:
        plan = self.db.get(LearningPlan, plan_id)
        if plan is None or plan.child_id != child.id:
            raise NotFoundError("Learning plan not found")
        return plan

    def _active_plan(self, child: Child, plan_id: uuid.UUID) -> LearningPlan:
        plan = self._plan(child, plan_id)
        if not plan.is_active:
            raise ConflictError(
                "Archived plans can't be changed. Start a new plan instead.", code="plan_archived"
            )
        return plan

    def _games(self, items: list[PlanItemIn]) -> dict[str, Game]:
        """Look up each item's game by slug; only games that can be played now are allowed."""
        slugs = {item.game for item in items}
        if not slugs:
            return {}
        games = {
            g.slug: g
            for g in self.db.scalars(select(Game).where(Game.slug.in_(slugs), Game.is_active))
        }
        unknown = sorted(slugs - games.keys())
        if unknown:
            raise NotFoundError("Game not found", code="game_not_found", details={"games": unknown})
        return games

    def _add_items(
        self, plan: LearningPlan, items: list[PlanItemIn], games: dict[str, Game]
    ) -> None:
        for item in items:
            self.db.add(
                LearningPlanItem(
                    plan_id=plan.id,
                    game_id=games[item.game].id,
                    sessions_per_week=item.sessions_per_week,
                    difficulty=item.difficulty,
                    notes=item.notes,
                )
            )
        self.db.flush()

    def _out(self, plans: list[LearningPlan]) -> list[LearningPlanOut]:
        """Build responses with one query for all items and one for all authors."""
        if not plans:
            return []
        items: dict[uuid.UUID, list[PlanItemOut]] = defaultdict(list)
        rows = self.db.execute(
            select(LearningPlanItem, Game)
            .join(Game, Game.id == LearningPlanItem.game_id)
            .where(LearningPlanItem.plan_id.in_([p.id for p in plans]))
            .order_by(Game.sort_order, Game.title)
        )
        for item, game in rows:
            items[item.plan_id].append(
                PlanItemOut(
                    id=item.id,
                    game=SessionGameOut(slug=game.slug, title=game.title, category=game.category),
                    sessions_per_week=item.sessions_per_week,
                    difficulty=item.difficulty,
                    notes=item.notes,
                )
            )
        author_ids = {p.created_by_id for p in plans if p.created_by_id is not None}
        authors = {
            u.id: AuthorOut(id=u.id, first_name=u.first_name, last_name=u.last_name)
            for u in self.db.scalars(select(User).where(User.id.in_(author_ids)))
        }
        return [
            LearningPlanOut(
                id=p.id,
                child_id=p.child_id,
                title=p.title,
                notes=p.notes,
                is_active=p.is_active,
                created_by=authors.get(p.created_by_id) if p.created_by_id else None,
                items=items[p.id],
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
            for p in plans
        ]

    def _audit(
        self,
        child: Child,
        plan: LearningPlan | None,
        action: str,
        details: dict[str, object] | None = None,
    ) -> None:
        record_event(
            self.db,
            action,
            resource_type="learning_plan",
            resource_id=plan.id if plan else None,
            actor_user_id=self.principal.id,
            child_id=child.id,
            ip_address=self.client_ip,
            details=details,
        )

    def _audit_therapist_view(self, child: Child) -> None:
        if self.principal.kind is PrincipalKind.THERAPIST:
            self._audit(child, None, "learning_plans_viewed")
            self.db.commit()
