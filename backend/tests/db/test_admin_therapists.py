import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, TherapistApprovalStatus, TherapistProfile, User, UserRole
from tests.factories import DEFAULT_PASSWORD, make_therapist, make_user
from tests.fakes import RecordingEmailSender


def token_for(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin(db_session: Session) -> User:
    return make_user(db_session, role=UserRole.ADMIN, password=DEFAULT_PASSWORD)


@pytest.fixture
def pending(db_session: Session) -> User:
    return make_therapist(
        db_session, status=TherapistApprovalStatus.PENDING, password=DEFAULT_PASSWORD
    )


def test_only_admins_can_use_admin_endpoints(db_client: TestClient, db_session: Session) -> None:
    parent = make_user(db_session, password=DEFAULT_PASSWORD)

    assert db_client.get("/api/admin/therapists").status_code == 401
    response = db_client.get("/api/admin/therapists", headers=token_for(db_client, parent))
    assert response.status_code == 403


def test_admin_lists_therapists_by_status(
    db_client: TestClient, db_session: Session, admin: User, pending: User
) -> None:
    make_therapist(db_session)  # already approved
    headers = token_for(db_client, admin)

    pending_list = db_client.get("/api/admin/therapists?status=pending", headers=headers).json()
    everyone = db_client.get("/api/admin/therapists", headers=headers).json()

    assert [t["id"] for t in pending_list] == [str(pending.id)]
    assert len(everyone) == 2


def test_approving_a_therapist_unlocks_their_access(
    db_client: TestClient,
    db_session: Session,
    admin: User,
    pending: User,
    mailbox: RecordingEmailSender,
) -> None:
    therapist_headers = token_for(db_client, pending)
    me = db_client.get("/api/auth/me", headers=therapist_headers).json()
    assert me["therapist_status"] == "pending"

    response = db_client.post(
        f"/api/admin/therapists/{pending.id}/approve", headers=token_for(db_client, admin)
    )

    assert response.status_code == 200
    assert response.json()["approval_status"] == "approved"
    profile = db_session.get(TherapistProfile, pending.id)
    assert profile is not None and profile.reviewed_by_id == admin.id
    assert mailbox.to(pending.email)[-1].subject.endswith("approved")
    assert (
        db_client.get("/api/auth/me", headers=therapist_headers).json()["therapist_status"]
        == "approved"
    )
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert "therapist_approved" in actions


def test_rejecting_a_therapist_records_the_reason(
    db_client: TestClient, admin: User, pending: User, mailbox: RecordingEmailSender
) -> None:
    response = db_client.post(
        f"/api/admin/therapists/{pending.id}/reject",
        json={"reason": "Licence number could not be verified"},
        headers=token_for(db_client, admin),
    )

    assert response.status_code == 200
    assert response.json()["approval_status"] == "rejected"
    assert response.json()["rejection_reason"] == "Licence number could not be verified"
    assert "Licence number could not be verified" in mailbox.to(pending.email)[-1].body


def test_rejecting_needs_a_reason(db_client: TestClient, admin: User, pending: User) -> None:
    response = db_client.post(
        f"/api/admin/therapists/{pending.id}/reject",
        json={"reason": "  "},
        headers=token_for(db_client, admin),
    )

    assert response.status_code == 422


def test_approving_someone_who_is_not_a_therapist_is_a_404(
    db_client: TestClient, db_session: Session, admin: User
) -> None:
    parent = make_user(db_session)
    headers = token_for(db_client, admin)

    for target in (parent.id, uuid.uuid4()):
        response = db_client.post(f"/api/admin/therapists/{target}/approve", headers=headers)
        assert response.status_code == 404
