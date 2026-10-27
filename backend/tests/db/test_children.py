from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.passwords import hash_secret
from app.db.models import (
    AuditLog,
    Child,
    Goal,
    RefreshToken,
    TherapistApprovalStatus,
    TherapistChildLink,
    TherapistLinkStatus,
    User,
    UserRole,
)
from tests.conftest import AuthHeaders
from tests.factories import (
    DEFAULT_PASSWORD,
    DEFAULT_PIN,
    link_therapist,
    make_child,
    make_therapist,
    make_user,
)

NEW_CHILD: dict[str, Any] = {
    "display_name": "  Zara ",
    "date_of_birth": "2018-03-14",
    "gender": "female",
    "avatar": "owl",
    "hearing_difficulties": ["noisy_environments", "rapid_speech", "noisy_environments"],
    "speech_challenges": ["pronunciation"],
    "interests": ["animals", "space"],
    "focus_areas": ["listening_skills"],
    "learning_environment": "school",
    "attention_span": "short",
    "preferred_learning_style": "auditory",
    "session_length_minutes": 15,
    "notes": "Struggles most in the classroom.",
}


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent, notes="Private parent note")


# ---------------------------------------------------------------- create


def test_parent_creates_a_child_with_a_typed_profile(
    db_client: TestClient, db_session: Session, parent: User, auth_headers: AuthHeaders
) -> None:
    response = db_client.post("/api/children", json=NEW_CHILD, headers=auth_headers(parent))

    assert response.status_code == 201
    body = response.json()
    assert body["display_name"] == "Zara"
    assert body["hearing_difficulties"] == ["noisy_environments", "rapid_speech"]  # de-duplicated
    assert body["age_years"] >= 7
    assert body["login"] is None
    child = db_session.get(Child, body["id"])
    assert child is not None and child.parent_id == parent.id
    assert "child_created" in db_session.scalars(select(AuditLog.action)).all()


@pytest.mark.parametrize(
    "changes",
    [
        {"hearing_difficulties": ["cannot_hear_well"]},
        {"avatar": "dragon"},
        {"session_length_minutes": 7},
        {"date_of_birth": (date.today() + timedelta(days=1)).isoformat()},
        {"date_of_birth": "2000-01-01"},
        {"display_name": "   "},
        {"is_admin": True},
    ],
    ids=["unknown-tag", "unknown-avatar", "odd-length", "future-dob", "adult", "blank", "extra"],
)
def test_invalid_profiles_are_rejected(
    db_client: TestClient, parent: User, auth_headers: AuthHeaders, changes: dict[str, Any]
) -> None:
    response = db_client.post(
        "/api/children", json=NEW_CHILD | changes, headers=auth_headers(parent)
    )

    assert response.status_code == 422


def test_only_parents_create_children(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    therapist = make_therapist(db_session)

    for account in (therapist, child):
        response = db_client.post("/api/children", json=NEW_CHILD, headers=auth_headers(account))
        assert response.status_code == 403


# ---------------------------------------------------------------- read


def test_list_shows_each_caller_only_their_children(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    sibling = make_child(db_session, parent, display_name="Omar")
    make_child(db_session, make_user(db_session), display_name="Someone else")
    linked = make_therapist(db_session)
    link_therapist(db_session, linked, child)
    invited_only = make_therapist(db_session)
    link_therapist(db_session, invited_only, sibling, TherapistLinkStatus.PENDING)
    unapproved = make_therapist(db_session, status=TherapistApprovalStatus.PENDING)
    link_therapist(db_session, unapproved, child)

    def names(account: User | Child) -> list[str]:
        response = db_client.get("/api/children", headers=auth_headers(account))
        assert response.status_code == 200
        return [c["display_name"] for c in response.json()]

    assert names(parent) == ["Ali", "Omar"]
    assert names(linked) == ["Ali"]
    assert names(invited_only) == []
    assert names(unapproved) == []
    assert names(child) == ["Ali"]


def test_admins_cannot_list_children(
    db_client: TestClient, db_session: Session, auth_headers: AuthHeaders
) -> None:
    admin = make_user(db_session, role=UserRole.ADMIN)

    assert db_client.get("/api/children", headers=auth_headers(admin)).status_code == 403


def test_other_parents_get_404_for_my_child(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    stranger = make_user(db_session)

    response = db_client.get(f"/api/children/{child.id}", headers=auth_headers(stranger))

    assert response.status_code == 404


def test_linked_therapists_can_read_and_their_access_is_audited(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    therapist = make_therapist(db_session)
    link_therapist(db_session, therapist, child)

    response = db_client.get(f"/api/children/{child.id}", headers=auth_headers(therapist))

    assert response.status_code == 200
    assert response.json()["notes"] == "Private parent note"
    assert response.json()["login"] is None
    viewed = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "child_viewed", AuditLog.child_id == child.id)
    ).all()
    assert [v.actor_user_id for v in viewed] == [therapist.id]


def test_a_child_sees_their_profile_without_parent_notes(
    db_client: TestClient, child: Child, auth_headers: AuthHeaders
) -> None:
    response = db_client.get(f"/api/children/{child.id}", headers=auth_headers(child))

    assert response.status_code == 200
    assert response.json()["notes"] is None


# ---------------------------------------------------------------- update & delete


def test_parent_updates_only_the_fields_sent(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders
) -> None:
    response = db_client.patch(
        f"/api/children/{child.id}",
        json={"interests": ["music"], "notes": None},
        headers=auth_headers(parent),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["interests"] == ["music"]
    assert body["notes"] is None
    assert body["display_name"] == "Ali"


def test_required_fields_cannot_be_cleared(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders
) -> None:
    response = db_client.patch(
        f"/api/children/{child.id}", json={"display_name": None}, headers=auth_headers(parent)
    )

    assert response.status_code == 422


def test_therapists_and_strangers_cannot_edit(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    therapist = make_therapist(db_session)
    link_therapist(db_session, therapist, child)
    stranger = make_user(db_session)
    url = f"/api/children/{child.id}"

    assert (
        db_client.patch(url, json={"avatar": "cat"}, headers=auth_headers(therapist)).status_code
        == 403
    )
    assert (
        db_client.patch(url, json={"avatar": "cat"}, headers=auth_headers(stranger)).status_code
        == 404
    )
    deleting = db_client.post(
        f"{url}/delete", json={"password": DEFAULT_PASSWORD}, headers=auth_headers(stranger)
    )
    assert deleting.status_code == 404


def test_deleting_a_child_removes_their_data(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    parent.password_hash = hash_secret(DEFAULT_PASSWORD)
    db_session.add(Goal(child_id=child.id, title="Play daily", target_value=7))
    link_therapist(db_session, make_therapist(db_session), child)
    db_session.flush()
    child_id = child.id

    response = db_client.post(
        f"/api/children/{child_id}/delete",
        json={"password": DEFAULT_PASSWORD},
        headers=auth_headers(parent),
    )

    assert response.status_code == 204
    db_session.expire_all()
    assert db_session.get(Child, child_id) is None
    for model in (Goal, TherapistChildLink):
        count = db_session.scalar(
            select(func.count()).select_from(model).where(model.child_id == child_id)
        )
        assert count == 0
    assert "child_deleted" in db_session.scalars(select(AuditLog.action)).all()


# ---------------------------------------------------------------- child sign-in


def test_parent_sets_a_login_that_the_child_can_use(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders
) -> None:
    response = db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": " Ali.K ", "pin": "4826"},
        headers=auth_headers(parent),
    )

    assert response.status_code == 200
    assert response.json()["login"] == {"username": "ali.k"}
    login = db_client.post("/api/auth/child-login", json={"username": "ali.k", "pin": "4826"})
    assert login.status_code == 200


@pytest.mark.parametrize("pin", ["1111", "1234", "9876", "12"])
def test_easy_pins_are_refused(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders, pin: str
) -> None:
    response = db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": "ali", "pin": pin},
        headers=auth_headers(parent),
    )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert all(pin not in detail["msg"] and "input" not in detail for detail in details)


@pytest.mark.parametrize("username", ["ab", "1abc", "has space", "a" * 31])
def test_bad_usernames_are_refused(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders, username: str
) -> None:
    response = db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": username, "pin": "4826"},
        headers=auth_headers(parent),
    )

    assert response.status_code == 422


def test_usernames_are_unique_across_families(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    make_child(db_session, make_user(db_session), pin=DEFAULT_PIN, username="taken")

    response = db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": "Taken", "pin": "4826"},
        headers=auth_headers(parent),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "username_taken"


def test_changing_or_removing_the_login_signs_the_child_out(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    auth_headers: AuthHeaders,
) -> None:
    child = make_child(db_session, parent, pin=DEFAULT_PIN, username="sam")
    assert (
        db_client.post(
            "/api/auth/child-login", json={"username": "sam", "pin": DEFAULT_PIN}
        ).status_code
        == 200
    )

    db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": "sam", "pin": "5937"},
        headers=auth_headers(parent),
    )

    live = db_session.scalars(
        select(RefreshToken).where(
            RefreshToken.child_id == child.id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    assert live == []
    assert db_client.post("/api/auth/refresh").status_code == 401

    removed = db_client.delete(f"/api/children/{child.id}/login", headers=auth_headers(parent))
    assert removed.json()["login"] is None
    login = db_client.post("/api/auth/child-login", json={"username": "sam", "pin": "5937"})
    assert login.status_code == 401


def test_setting_a_login_clears_a_lockout(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    child.locked_until = datetime.now(UTC) + timedelta(minutes=10)
    db_session.flush()

    db_client.put(
        f"/api/children/{child.id}/login",
        json={"username": "ali", "pin": "4826"},
        headers=auth_headers(parent),
    )

    assert (
        db_client.post("/api/auth/child-login", json={"username": "ali", "pin": "4826"}).status_code
        == 200
    )
