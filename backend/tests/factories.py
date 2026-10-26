"""Small helpers to insert valid rows; tests override only the fields they care about."""

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Child, Difficulty, Game, GameSession, SkillCategory, User, UserRole


def make_user(session: Session, **overrides: Any) -> User:
    values: dict[str, Any] = {
        "email": f"user-{uuid.uuid4().hex[:8]}@example.com",
        "password_hash": "not-a-real-hash",
        "role": UserRole.PARENT,
        "first_name": "Test",
        "last_name": "User",
    }
    user = User(**(values | overrides))
    session.add(user)
    session.flush()
    return user


def make_child(session: Session, parent: User, **overrides: Any) -> Child:
    values: dict[str, Any] = {
        "parent_id": parent.id,
        "display_name": "Ali",
        "date_of_birth": date(2018, 5, 1),
    }
    child = Child(**(values | overrides))
    session.add(child)
    session.flush()
    return child


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
