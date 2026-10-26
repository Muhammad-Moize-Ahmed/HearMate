from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import AuditLog, OneTimeCode, TherapistApprovalStatus, TherapistProfile, User
from tests.factories import DEFAULT_PASSWORD, make_user
from tests.fakes import RecordingEmailSender

EMAIL = "sara.parent@example.com"


def signup(client: TestClient, **overrides: Any) -> Any:
    body = {
        "email": EMAIL,
        "password": DEFAULT_PASSWORD,
        "first_name": "Sara",
        "last_name": "Khan",
    } | overrides
    return client.post("/api/auth/signup", json=body)


def verify(client: TestClient, code: str, password: str = DEFAULT_PASSWORD) -> Any:
    return client.post(
        "/api/auth/verify-email", json={"email": EMAIL, "password": password, "code": code}
    )


def test_parent_signup_emails_a_code_and_cannot_log_in_until_verified(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    response = signup(db_client, email="Sara.Parent@Example.com")

    assert response.status_code == 202
    user = db_session.scalar(select(User).where(User.email == EMAIL))
    assert user is not None and user.email_verified_at is None
    assert user.password_hash != DEFAULT_PASSWORD
    assert len(mailbox.last_code_for(EMAIL)) == 6
    stored = db_session.scalar(select(OneTimeCode).where(OneTimeCode.user_id == user.id))
    assert stored is not None and mailbox.last_code_for(EMAIL) not in stored.code_hash

    login = db_client.post("/api/auth/login", json={"email": EMAIL, "password": DEFAULT_PASSWORD})
    assert login.status_code == 403
    assert login.json()["error"]["code"] == "email_not_verified"


def test_verifying_with_code_and_password_signs_in(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    signup(db_client)

    response = verify(db_client, mailbox.last_code_for(EMAIL))

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["principal"]["kind"] == "parent"
    assert body["principal"]["email"] == EMAIL
    assert "hm_refresh" in response.cookies
    me = db_client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json()["email"] == EMAIL


def test_verification_needs_the_right_password(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    signup(db_client)

    response = verify(db_client, mailbox.last_code_for(EMAIL), password="someone-elses-pw")

    assert response.status_code == 401


def test_a_wrong_code_is_rejected_and_five_misses_burn_the_code(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    signup(db_client)
    code = mailbox.last_code_for(EMAIL)
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"

    for _ in range(5):
        response = verify(db_client, wrong)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_code"

    assert verify(db_client, code).status_code == 400


def test_an_expired_code_is_rejected(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    signup(db_client)
    db_session.execute(
        update(OneTimeCode).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    assert verify(db_client, mailbox.last_code_for(EMAIL)).status_code == 400


def test_signup_for_an_existing_account_reveals_nothing_and_changes_nothing(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    existing = make_user(db_session, email=EMAIL, password=DEFAULT_PASSWORD)
    old_hash = existing.password_hash

    response = signup(db_client, password="a-brand-new-password")

    assert response.status_code == 202
    assert response.json() == {"message": "Check your email to continue."}
    assert mailbox.to(EMAIL)[-1].subject == "You already have a HearMate account"
    db_session.refresh(existing)
    assert existing.password_hash == old_hash


def test_a_squatter_cannot_keep_an_unverified_account(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    signup(db_client, password="squatters-password")  # someone else uses Sara's email first
    code_sent_to_sara = mailbox.last_code_for(EMAIL)

    signup(db_client, password="saras-real-password")  # Sara signs up herself

    assert verify(db_client, code_sent_to_sara, password="squatters-password").status_code == 401
    assert verify(db_client, code_sent_to_sara, password="saras-real-password").status_code == 200


def test_resend_respects_the_cooldown_then_replaces_the_code(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    signup(db_client)
    first_code = mailbox.last_code_for(EMAIL)

    db_client.post("/api/auth/resend-verification", json={"email": EMAIL})
    assert len(mailbox.to(EMAIL)) == 1  # still cooling down

    db_session.execute(
        update(OneTimeCode).values(created_at=datetime.now(UTC) - timedelta(minutes=2))
    )
    response = db_client.post("/api/auth/resend-verification", json={"email": EMAIL})

    assert response.status_code == 202
    assert len(mailbox.to(EMAIL)) == 2
    new_code = mailbox.last_code_for(EMAIL)
    if new_code != first_code:
        assert verify(db_client, first_code).status_code == 400
    assert verify(db_client, new_code).status_code == 200


def test_resend_for_unknown_email_looks_the_same(
    db_client: TestClient, mailbox: RecordingEmailSender
) -> None:
    response = db_client.post("/api/auth/resend-verification", json={"email": "nobody@x.com"})

    assert response.status_code == 202
    assert mailbox.sent == []


def test_therapist_signup_starts_pending_approval(
    db_client: TestClient, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    response = signup(
        db_client,
        role="therapist",
        therapist={"license_number": "PMDC-123", "organization": "City Speech Clinic"},
    )

    assert response.status_code == 202
    user = db_session.scalar(select(User).where(User.email == EMAIL))
    assert user is not None
    profile = db_session.get(TherapistProfile, user.id)
    assert profile is not None
    assert profile.approval_status is TherapistApprovalStatus.PENDING
    assert profile.license_number == "PMDC-123"

    verified = verify(db_client, mailbox.last_code_for(EMAIL))
    assert verified.json()["principal"]["therapist_status"] == "pending"


def test_parents_cannot_send_therapist_details(db_client: TestClient) -> None:
    response = signup(db_client, therapist={"organization": "x"})

    assert response.status_code == 422


def test_admin_accounts_cannot_be_created_by_signup(db_client: TestClient) -> None:
    response = signup(db_client, role="admin")

    assert response.status_code == 422


def test_short_passwords_are_rejected_without_echoing_them(db_client: TestClient) -> None:
    response = signup(db_client, password="short123")

    assert response.status_code == 422
    assert "short123" not in response.text


def test_signup_is_audited(db_client: TestClient, db_session: Session) -> None:
    signup(db_client)

    actions = db_session.scalars(select(AuditLog.action)).all()
    assert "user_signed_up" in actions
