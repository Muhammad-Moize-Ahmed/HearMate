import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.auth.principal import Principal, PrincipalKind
from app.auth.tokens import create_access_token
from app.core.config import Settings
from app.db.models import AuditLog, RefreshToken, User, UserStatus
from tests.factories import DEFAULT_PASSWORD, DEFAULT_PIN, make_child, make_user
from tests.fakes import RecordingEmailSender

REFRESH = "/api/auth/refresh"


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session, email="parent@example.com", password=DEFAULT_PASSWORD)


def log_in(client: TestClient, parent: User) -> str:
    response = client.post(
        "/api/auth/login", json={"email": parent.email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200
    return str(response.json()["access_token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def refresh_with(client: TestClient, raw_token: str) -> Any:
    """Present a specific refresh token (an explicit Cookie header wins over the client jar)."""
    return client.post(REFRESH, headers={"Cookie": f"hm_refresh={raw_token}"})


def test_me_requires_a_token(db_client: TestClient) -> None:
    response = db_client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthenticated"


def test_me_rejects_a_garbage_token(db_client: TestClient) -> None:
    response = db_client.get("/api/auth/me", headers=bearer("nope"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


def test_tokens_stop_working_when_the_account_is_disabled_or_deleted(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    token = log_in(db_client, parent)
    assert db_client.get("/api/auth/me", headers=bearer(token)).status_code == 200

    parent.status = UserStatus.DISABLED
    db_session.flush()
    assert db_client.get("/api/auth/me", headers=bearer(token)).status_code == 401

    db_session.execute(delete(User).where(User.id == parent.id))
    assert db_client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_a_token_claiming_the_wrong_role_is_rejected(
    db_client: TestClient, parent: User, test_settings: Settings
) -> None:
    forged_kind = Principal(kind=PrincipalKind.ADMIN, id=parent.id)
    token = create_access_token(
        forged_kind, secret_key=test_settings.secret_key(), ttl=timedelta(minutes=5)
    )

    assert db_client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_refresh_rotates_the_token(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    log_in(db_client, parent)
    first_cookie = db_client.cookies["hm_refresh"]

    response = db_client.post(REFRESH)

    assert response.status_code == 200
    assert response.json()["principal"]["id"] == str(parent.id)
    assert db_client.cookies["hm_refresh"] != first_cookie
    tokens = db_session.scalars(select(RefreshToken).where(RefreshToken.user_id == parent.id))
    states = sorted(t.revoked_at is None for t in tokens)
    assert states == [False, True]  # the old one is revoked, the new one is live


def test_reusing_an_old_refresh_token_ends_the_whole_session(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    log_in(db_client, parent)
    stolen = db_client.cookies["hm_refresh"]
    db_client.post(REFRESH)  # legitimate rotation
    current = db_client.cookies["hm_refresh"]

    replay = refresh_with(db_client, stolen)

    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "session_expired"
    # the legitimate, newer token is revoked too
    assert refresh_with(db_client, current).status_code == 401
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert "refresh_token_reused" in actions


def test_refresh_without_a_cookie_is_rejected(db_client: TestClient) -> None:
    assert db_client.post(REFRESH).status_code == 401


def test_expired_refresh_tokens_are_rejected(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    log_in(db_client, parent)
    db_session.execute(
        update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    assert db_client.post(REFRESH).status_code == 401


def test_refresh_stops_working_for_disabled_accounts(
    db_client: TestClient, db_session: Session, parent: User
) -> None:
    log_in(db_client, parent)
    parent.status = UserStatus.DISABLED
    db_session.flush()

    assert db_client.post(REFRESH).status_code == 401


def test_logout_revokes_the_session_and_clears_the_cookie(
    db_client: TestClient, parent: User
) -> None:
    log_in(db_client, parent)
    cookie = db_client.cookies["hm_refresh"]

    response = db_client.post("/api/auth/logout")

    assert response.status_code == 204
    assert 'hm_refresh=""' in response.headers["set-cookie"]
    assert refresh_with(db_client, cookie).status_code == 401


def test_logout_without_a_session_still_succeeds(db_client: TestClient) -> None:
    assert db_client.post("/api/auth/logout").status_code == 204


def test_child_sessions_refresh_as_the_child(db_client: TestClient, db_session: Session) -> None:
    child = make_child(db_session, make_user(db_session), pin=DEFAULT_PIN, username="sara")
    db_client.post("/api/auth/child-login", json={"username": "sara", "pin": DEFAULT_PIN})

    response = db_client.post(REFRESH)

    assert response.status_code == 200
    assert response.json()["principal"] == {
        "kind": "child",
        "id": str(child.id),
        "display_name": "Ali",
        "avatar": "bear",
    }


def test_password_reset_flow(
    db_client: TestClient, db_session: Session, parent: User, mailbox: RecordingEmailSender
) -> None:
    log_in(db_client, parent)
    old_session_cookie = db_client.cookies["hm_refresh"]

    forgot = db_client.post("/api/auth/password/forgot", json={"email": parent.email})
    assert forgot.status_code == 202
    code = mailbox.last_code_for(parent.email)

    reset = db_client.post(
        "/api/auth/password/reset",
        json={"email": parent.email, "code": code, "new_password": "a-whole-new-password"},
    )

    assert reset.status_code == 204
    old_login = db_client.post(
        "/api/auth/login", json={"email": parent.email, "password": DEFAULT_PASSWORD}
    )
    assert old_login.status_code == 401
    new_login = db_client.post(
        "/api/auth/login", json={"email": parent.email, "password": "a-whole-new-password"}
    )
    assert new_login.status_code == 200
    # every session from before the reset is gone
    assert refresh_with(db_client, old_session_cookie).status_code == 401


def test_forgot_password_for_unknown_email_looks_the_same(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    response = db_client.post("/api/auth/password/forgot", json={"email": "nobody@example.com"})

    assert response.status_code == 202
    assert response.json() == {"message": "Check your email to continue."}
    assert mailbox.sent == []


def test_reset_with_a_wrong_code_fails(db_client: TestClient, parent: User) -> None:
    db_client.post("/api/auth/password/forgot", json={"email": parent.email})

    response = db_client.post(
        "/api/auth/password/reset",
        json={"email": parent.email, "code": "000000", "new_password": "a-whole-new-password"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_code"


def test_a_reset_code_cannot_verify_an_email(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    user = make_user(db_session, password=DEFAULT_PASSWORD, verified=False)
    db_client.post("/api/auth/password/forgot", json={"email": user.email})
    reset_code = mailbox.last_code_for(user.email)

    response = db_client.post(
        "/api/auth/verify-email",
        json={"email": user.email, "password": DEFAULT_PASSWORD, "code": reset_code},
    )

    assert response.status_code == 400


def test_unknown_principal_ids_are_rejected(db_client: TestClient, test_settings: Settings) -> None:
    ghost = Principal(kind=PrincipalKind.PARENT, id=uuid.uuid4())
    token = create_access_token(
        ghost, secret_key=test_settings.secret_key(), ttl=timedelta(minutes=5)
    )

    assert db_client.get("/api/auth/me", headers=bearer(token)).status_code == 401
