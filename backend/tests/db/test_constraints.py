"""The database itself enforces the invariants, not just the API layer."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import (
    Child,
    GameSession,
    RefreshToken,
    SessionStatus,
    TherapistChildLink,
    TherapistLinkStatus,
    User,
    UserRole,
)
from tests.factories import make_child, make_game, make_session, make_user


def assert_rejected(session: Session) -> None:
    # The nested savepoint keeps earlier rows from this test usable after the failure.
    with pytest.raises(IntegrityError), session.begin_nested():
        session.flush()


def test_deleting_a_parent_deletes_their_children_and_sessions(db_session: Session) -> None:
    parent = make_user(db_session)
    child = make_child(db_session, parent)
    game_session = make_session(db_session, child, make_game(db_session))

    db_session.execute(delete(User).where(User.id == parent.id))

    assert db_session.get(Child, child.id, populate_existing=True) is None
    assert db_session.scalar(select(GameSession).where(GameSession.id == game_session.id)) is None


def test_a_game_with_history_cannot_be_deleted(db_session: Session) -> None:
    game = make_game(db_session)
    make_session(db_session, make_child(db_session, make_user(db_session)), game)

    with pytest.raises(IntegrityError):
        db_session.execute(text("DELETE FROM games WHERE id = :id"), {"id": game.id})


def test_emails_must_be_unique(db_session: Session) -> None:
    make_user(db_session, email="same@example.com")
    db_session.add(
        User(
            email="same@example.com",
            password_hash="x",
            role=UserRole.PARENT,
            first_name="A",
            last_name="B",
        )
    )

    assert_rejected(db_session)


def test_emails_must_be_stored_lowercase(db_session: Session) -> None:
    db_session.add(
        User(
            email="Mixed@Example.com",
            password_hash="x",
            role=UserRole.PARENT,
            first_name="A",
            last_name="B",
        )
    )

    assert_rejected(db_session)


def test_unknown_enum_values_are_rejected_by_the_database(db_session: Session) -> None:
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO users (id, email, password_hash, role, status, first_name, last_name)"
                " VALUES (:id, 'x@example.com', 'x', 'superuser', 'active', 'A', 'B')"
            ),
            {"id": uuid.uuid4()},
        )


def test_child_login_needs_both_username_and_pin(db_session: Session) -> None:
    parent = make_user(db_session)
    db_session.add(
        Child(
            parent_id=parent.id,
            display_name="Sara",
            date_of_birth=datetime(2017, 1, 1).date(),
            username="sara",
        )
    )

    assert_rejected(db_session)


def test_child_usernames_are_unique(db_session: Session) -> None:
    parent = make_user(db_session)
    make_child(db_session, parent, username="sara", pin_hash="h")
    db_session.add(
        Child(
            parent_id=parent.id,
            display_name="Sara 2",
            date_of_birth=datetime(2017, 1, 1).date(),
            username="sara",
            pin_hash="h",
        )
    )

    assert_rejected(db_session)


def test_only_one_live_therapist_link_per_child(db_session: Session) -> None:
    parent = make_user(db_session)
    therapist = make_user(db_session, role=UserRole.THERAPIST)
    child = make_child(db_session, parent)

    def link(status: TherapistLinkStatus) -> None:
        db_session.add(
            TherapistChildLink(therapist_id=therapist.id, child_id=child.id, status=status)
        )
        db_session.flush()

    link(TherapistLinkStatus.REVOKED)
    link(TherapistLinkStatus.ACTIVE)  # a revoked link does not block a new one

    with pytest.raises(IntegrityError):
        link(TherapistLinkStatus.PENDING)


def test_completed_sessions_need_a_completion_time(db_session: Session) -> None:
    child = make_child(db_session, make_user(db_session))
    game = make_game(db_session)

    with pytest.raises(IntegrityError), db_session.begin_nested():
        make_session(db_session, child, game, status=SessionStatus.COMPLETED)

    completed = make_session(
        db_session,
        child,
        game,
        status=SessionStatus.COMPLETED,
        completed_at=datetime.now(UTC),
        total_rounds=10,
        correct_rounds=8,
        accuracy=80.0,
    )
    assert completed.status is SessionStatus.COMPLETED


@pytest.mark.parametrize(
    "overrides",
    [{"accuracy": 101.0}, {"points": -1}, {"total_rounds": 3, "correct_rounds": 4}],
)
def test_session_scores_must_be_in_range(db_session: Session, overrides: dict[str, object]) -> None:
    child = make_child(db_session, make_user(db_session))

    with pytest.raises(IntegrityError):
        make_session(db_session, child, make_game(db_session), **overrides)


def test_refresh_tokens_belong_to_exactly_one_principal(db_session: Session) -> None:
    parent = make_user(db_session)
    child = make_child(db_session, parent)
    db_session.add(
        RefreshToken(
            user_id=parent.id,
            child_id=child.id,
            token_hash="hash",
            family_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
    )

    assert_rejected(db_session)


def test_timestamps_are_timezone_aware(db_session: Session) -> None:
    user = make_user(db_session)
    db_session.refresh(user)

    assert user.created_at.tzinfo is not None
    assert user.updated_at.tzinfo is not None
