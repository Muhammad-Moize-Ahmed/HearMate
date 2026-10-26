"""Small helpers to insert valid rows; tests override only the fields they care about."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.auth.passwords import hash_secret
from app.db.models import (
    Child,
    Difficulty,
    Game,
    GameSession,
    SkillCategory,
    TherapistApprovalStatus,
    TherapistChildLink,
    TherapistLinkStatus,
    TherapistProfile,
    User,
    UserRole,
)

DEFAULT_PASSWORD = "correct-horse-battery"
DEFAULT_PIN = "4826"


def make_user(
    session: Session,
    *,
    password: str | None = None,
    verified: bool = True,
    **overrides: Any,
) -> User:
    """`password` is hashed for real (slow); without it the hash is a placeholder."""
    values: dict[str, Any] = {
        "email": f"user-{uuid.uuid4().hex[:8]}@example.com",
        "password_hash": hash_secret(password) if password else "not-a-real-hash",
        "role": UserRole.PARENT,
        "first_name": "Test",
        "last_name": "User",
        "email_verified_at": datetime.now(UTC) if verified else None,
    }
    user = User(**(values | overrides))
    session.add(user)
    session.flush()
    return user


def make_therapist(
    session: Session,
    *,
    status: TherapistApprovalStatus = TherapistApprovalStatus.APPROVED,
    **overrides: Any,
) -> User:
    user = make_user(session, role=UserRole.THERAPIST, **overrides)
    session.add(TherapistProfile(user_id=user.id, approval_status=status))
    session.flush()
    return user


def make_child(
    session: Session, parent: User, *, pin: str | None = None, **overrides: Any
) -> Child:
    values: dict[str, Any] = {
        "parent_id": parent.id,
        "display_name": "Ali",
        "date_of_birth": date(2018, 5, 1),
    }
    if pin is not None:
        values["username"] = f"kid-{uuid.uuid4().hex[:8]}"
        values["pin_hash"] = hash_secret(pin)
    child = Child(**(values | overrides))
    session.add(child)
    session.flush()
    return child


def link_therapist(
    session: Session,
    therapist: User,
    child: Child,
    status: TherapistLinkStatus = TherapistLinkStatus.ACTIVE,
) -> TherapistChildLink:
    link = TherapistChildLink(
        therapist_id=therapist.id,
        child_id=child.id,
        granted_by_parent_id=child.parent_id,
        status=status,
    )
    session.add(link)
    session.flush()
    return link


def make_game(session: Session, **overrides: Any) -> Game:
    values: dict[str, Any] = {
        "slug": f"game-{uuid.uuid4().hex[:8]}",
        "title": "Sound Detective",
        "category": SkillCategory.LISTENING,
        "description": "Identify everyday sounds.",
    }
    game = Game(**(values | overrides))
    session.add(game)
    session.flush()
    return game


def make_session(session: Session, child: Child, game: Game, **overrides: Any) -> GameSession:
    values: dict[str, Any] = {
        "child_id": child.id,
        "game_id": game.id,
        "difficulty": Difficulty.EASY,
        "level_at_start": 1,
    }
    game_session = GameSession(**(values | overrides))
    session.add(game_session)
    session.flush()
    return game_session
