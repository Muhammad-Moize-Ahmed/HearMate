from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, Child, User, UserStatus
from tests.factories import DEFAULT_PASSWORD, DEFAULT_PIN, make_child, make_user


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> Any:
    return client.post("/api/auth/login", json={"email": email, "password": password})


def child_login(client: TestClient, username: str, pin: str = DEFAULT_PIN) -> Any:
    return client.post("/api/auth/child-login", json={"username": username, "pin": pin})


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session, email="parent@example.com", password=DEFAULT_PASSWORD)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent, pin=DEFAULT_PIN, username="ali")


def test_login_returns_an_access_token_and_a_locked_down_refresh_cookie(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    response = login(db_client, "Parent@Example.com")

    assert response.status_code == 200
    assert response.json()["principal"] == {
        "kind": "parent",
        "id": str(parent.id),
        "email": "parent@example.com",
        "first_name": "Test",
        "last_name": "User",
        "therapist_status": None,
    }
    assert response.headers["cache-control"] == "no-store"
    cookie = response.headers["set-cookie"]
    assert "hm_refresh=" in cookie
    assert "HttpOnly" in cookie
    assert "Path=/api/auth" in cookie
    assert "SameSite=lax" in cookie
    assert "hm_refresh" not in response.text  # the refresh token is never in the body
    db_session.refresh(parent)
    assert parent.last_login_at is not None


def test_wrong_password_and_unknown_email_look_identical(
    db_client: TestClient, parent: User
) -> None:
    wrong_password = login(db_client, parent.email, "not-my-password")
    unknown_email = login(db_client, "nobody@example.com")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["error"]["code"] == unknown_email.json()["error"]["code"]
    assert wrong_password.json()["error"]["message"] == unknown_email.json()["error"]["message"]


def test_five_wrong_passwords_lock_the_account(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    for _ in range(5):
        assert login(db_client, parent.email, "wrong-password").status_code == 401

    locked = login(db_client, parent.email)  # even the right password is refused while locked

    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "account_locked"
    assert int(locked.headers["retry-after"]) > 0
    actions = db_session.scalars(
        select(AuditLog.action).where(AuditLog.actor_user_id == parent.id)
    ).all()
    assert actions.count("login_failed") == 4
    assert "account_locked" in actions


def test_the_lock_expires(db_client: TestClient, db_session: Session, parent: User) -> None:
    parent.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    db_session.flush()

    assert login(db_client, parent.email).status_code == 200


def test_a_successful_login_resets_the_failure_count(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    for _ in range(4):
        login(db_client, parent.email, "wrong-password")
    login(db_client, parent.email)
    for _ in range(4):
        login(db_client, parent.email, "wrong-password")

    assert login(db_client, parent.email).status_code == 200


def test_disabled_accounts_cannot_log_in(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    parent.status = UserStatus.DISABLED
    db_session.flush()

    response = login(db_client, parent.email)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"


def test_login_is_rate_limited_per_email(db_client: TestClient, parent: User) -> None:
    for _ in range(10):
        assert login(db_client, parent.email).status_code == 200

    response = login(db_client, parent.email)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"


def test_child_logs_in_with_username_and_pin(db_client: TestClient, child: Child) -> None:
    response = child_login(db_client, "  ALI ")

    assert response.status_code == 200
    principal = response.json()["principal"]
    assert principal == {
        "kind": "child",
        "id": str(child.id),
        "display_name": "Ali",
        "avatar": "bear",
    }


def test_wrong_pin_is_rejected_and_five_lock_the_child(
    db_client: TestClient, db_session: Session, child: Child
) -> None:
    for _ in range(5):
        response = child_login(db_client, "ali", "0000")
        assert response.status_code == 401
        assert response.json()["error"]["message"] == "Invalid username or PIN"

    assert child_login(db_client, "ali").status_code == 429
    db_session.refresh(child)
    assert child.locked_until is not None


def test_children_without_login_details_cannot_log_in(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    make_child(db_session, parent)

    assert child_login(db_client, "nobody").status_code == 401


def test_children_of_disabled_parents_cannot_log_in(
    db_client: TestClient, db_session: Session, parent: User, child: Child
) -> None:
    parent.status = UserStatus.DISABLED
    db_session.flush()

    response = child_login(db_client, "ali")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"


@pytest.mark.parametrize("pin", ["12", "abcd", "123456789"])
def test_malformed_pins_are_rejected_by_validation(db_client: TestClient, pin: str) -> None:
    assert child_login(db_client, "ali", pin).status_code == 422
