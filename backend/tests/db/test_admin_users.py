"""Read-only admin views: the account list and dashboard counts."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import (
    Child,
    SessionStatus,
    TherapistApprovalStatus,
    User,
    UserRole,
    UserStatus,
)
from tests.conftest import AuthHeaders
from tests.factories import make_child, make_game, make_session, make_therapist, make_user

ENDPOINTS = ["/api/admin/users", "/api/admin/stats"]


@pytest.fixture
def admin(db_session: Session) -> User:
    return make_user(db_session, role=UserRole.ADMIN, email="ada@admin.example")


def users(client: TestClient, headers: dict[str, str], **params: str | int) -> dict[str, Any]:
    response = client.get("/api/admin/users", headers=headers, params=params)
    assert response.status_code == 200, response.text
    page: dict[str, Any] = response.json()
    return page


def emails(page: dict[str, Any]) -> list[str]:
    return [row["email"] for row in page["items"]]


# ------------------------------------------------------------------ access


@pytest.mark.parametrize("path", ENDPOINTS)
def test_signed_out_callers_get_401(db_client: TestClient, path: str) -> None:
    assert db_client.get(path).status_code == 401


@pytest.mark.parametrize("path", ENDPOINTS)
def test_non_admins_get_403(
    db_client: TestClient, db_session: Session, auth_headers: AuthHeaders, path: str
) -> None:
    parent = make_user(db_session)
    child = make_child(db_session, parent)
    callers: list[User | Child] = [
        parent,
        make_therapist(db_session),  # approved
        make_therapist(db_session, status=TherapistApprovalStatus.PENDING),
        child,
    ]
    for caller in callers:
        response = db_client.get(path, headers=auth_headers(caller))
        assert response.status_code == 403, caller


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_the_user_list_is_read_only(
    db_client: TestClient, admin: User, auth_headers: AuthHeaders, method: str
) -> None:
    response = db_client.request(method, "/api/admin/users", headers=auth_headers(admin))
    assert response.status_code == 405


def test_admin_routes_share_a_rate_limit_per_admin(
    app: FastAPI, db_client: TestClient, admin: User, auth_headers: AuthHeaders
) -> None:
    for _ in range(120):
        app.state.rate_limiter.hit(f"admin:{admin.id}", limit=120, window_seconds=60)

    for path in [*ENDPOINTS, "/api/admin/therapists"]:
        response = db_client.get(path, headers=auth_headers(admin))
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "rate_limited"


# ------------------------------------------------------------------ list


def test_lists_adult_accounts_newest_first_with_role_details(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    start = datetime(2026, 10, 1, tzinfo=UTC)
    parent = make_user(db_session, email="sam@example.com", created_at=start)
    make_child(db_session, parent, pin="4826", display_name="Ali")
    make_child(db_session, parent, display_name="Sara")
    therapist = make_therapist(
        db_session,
        status=TherapistApprovalStatus.PENDING,
        email="omar@clinic.example",
        created_at=start + timedelta(days=1),
    )
    admin.created_at = start - timedelta(days=1)
    db_session.flush()

    page = users(db_client, auth_headers(admin))

    assert page["total"] == 3
    assert emails(page) == [therapist.email, parent.email, admin.email]
    by_email = {row["email"]: row for row in page["items"]}
    assert by_email[parent.email]["children_count"] == 2
    assert by_email[parent.email]["therapist_status"] is None
    assert by_email[therapist.email]["therapist_status"] == "pending"
    assert by_email[therapist.email]["children_count"] is None
    assert by_email[admin.email]["role"] == "admin"


def test_never_exposes_childrens_details(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    parent = make_user(db_session)
    child = make_child(db_session, parent, pin="4826", display_name="Zainab")
    assert child.username

    body = db_client.get("/api/admin/users", headers=auth_headers(admin)).text
    body += db_client.get("/api/admin/stats", headers=auth_headers(admin)).text

    for secret in [child.username, "Zainab", str(child.id), child.pin_hash or "", "pin"]:
        assert secret not in body


def test_pages_through_results(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    base = datetime(2026, 10, 1, tzinfo=UTC)
    for i in range(5):
        make_user(db_session, email=f"p{i}@example.com", created_at=base + timedelta(hours=i))

    first = users(db_client, auth_headers(admin), role="parent", limit=2)
    third = users(db_client, auth_headers(admin), role="parent", limit=2, offset=4)

    assert first["total"] == 5 and first["limit"] == 2 and first["offset"] == 0
    assert emails(first) == ["p4@example.com", "p3@example.com"]
    assert emails(third) == ["p0@example.com"]


def test_searches_email_and_name_case_insensitively(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    make_user(db_session, email="sam@example.com", first_name="Sam", last_name="Khan")
    make_user(db_session, email="nadia@example.com", first_name="Nadia", last_name="Ahmed")
    headers = auth_headers(admin)

    assert emails(users(db_client, headers, q="SAM@")) == ["sam@example.com"]
    assert emails(users(db_client, headers, q="nadia ahm")) == ["nadia@example.com"]
    assert emails(users(db_client, headers, q="  khan ")) == ["sam@example.com"]
    # LIKE wildcards are matched literally, not as "anything".
    assert users(db_client, headers, q="%")["total"] == 0
    assert users(db_client, headers, q="_")["total"] == 0


def test_filters_by_role_and_account_status(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    make_user(db_session, email="on@example.com")
    make_user(db_session, email="off@example.com", status=UserStatus.DISABLED)
    make_therapist(db_session, email="t@example.com").status = UserStatus.DISABLED
    db_session.flush()
    headers = auth_headers(admin)

    assert sorted(emails(users(db_client, headers, role="parent"))) == [
        "off@example.com",
        "on@example.com",
    ]
    assert sorted(emails(users(db_client, headers, status="disabled"))) == [
        "off@example.com",
        "t@example.com",
    ]
    assert emails(users(db_client, headers, role="parent", status="disabled")) == [
        "off@example.com"
    ]


@pytest.mark.parametrize(
    "params",
    [{"role": "child"}, {"status": "deleted"}, {"limit": 0}, {"limit": 101}, {"offset": -1}],
)
def test_rejects_bad_filters(
    db_client: TestClient, admin: User, auth_headers: AuthHeaders, params: dict[str, str | int]
) -> None:
    response = db_client.get("/api/admin/users", headers=auth_headers(admin), params=params)
    assert response.status_code == 422


# ------------------------------------------------------------------ stats


def test_stats_count_accounts_children_and_recent_sessions(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    parent = make_user(db_session)
    make_user(db_session, status=UserStatus.DISABLED)
    make_therapist(db_session)
    make_therapist(db_session, status=TherapistApprovalStatus.PENDING)
    make_therapist(db_session, status=TherapistApprovalStatus.PENDING)
    make_therapist(db_session, status=TherapistApprovalStatus.REJECTED)
    child = make_child(db_session, parent)
    make_child(db_session, parent)
    game = make_game(db_session)
    now = datetime.now(UTC)
    for days_ago in [1, 6, 20, 45]:
        make_session(
            db_session,
            child,
            game,
            status=SessionStatus.COMPLETED,
            completed_at=now - timedelta(days=days_ago),
        )
    make_session(db_session, child, game)  # in progress: not counted
    make_session(db_session, child, game, status=SessionStatus.ABANDONED)  # not counted

    stats = db_client.get("/api/admin/stats", headers=auth_headers(admin)).json()

    assert stats == {
        "parents": 2,
        "therapists": {"total": 4, "pending": 2, "approved": 1, "rejected": 1},
        "admins": 1,
        "disabled_accounts": 1,
        "children": 2,
        "sessions_completed_last_7_days": 2,
        "sessions_completed_last_30_days": 3,
    }


# ------------------------------------------------------------------ the therapist's own view


def test_a_rejected_therapist_sees_why(
    db_client: TestClient, db_session: Session, admin: User, auth_headers: AuthHeaders
) -> None:
    therapist = make_therapist(db_session, status=TherapistApprovalStatus.PENDING)
    response = db_client.post(
        f"/api/admin/therapists/{therapist.id}/reject",
        headers=auth_headers(admin),
        json={"reason": "Licence number not found."},
    )
    assert response.status_code == 200

    me = db_client.get("/api/auth/me", headers=auth_headers(therapist)).json()

    assert me["therapist_status"] == "rejected"
    assert me["therapist_rejection_reason"] == "Licence number not found."

    db_client.post(f"/api/admin/therapists/{therapist.id}/approve", headers=auth_headers(admin))
    me = db_client.get("/api/auth/me", headers=auth_headers(therapist)).json()
    assert me["therapist_status"] == "approved"
    assert me["therapist_rejection_reason"] is None
