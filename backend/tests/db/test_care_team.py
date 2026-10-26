from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Child,
    TherapistApprovalStatus,
    TherapistLinkStatus,
    User,
)
from tests.conftest import AuthHeaders
from tests.factories import link_therapist, make_child, make_therapist, make_user
from tests.fakes import RecordingEmailSender

LINKS = "/api/therapist/links"


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session, first_name="Sara", last_name="Khan")


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent, display_name="Ali", notes="Private")


@pytest.fixture
def therapist(db_session: Session) -> User:
    return make_therapist(
        db_session, email="dr.raza@clinic.example", first_name="Ali", last_name="Raza"
    )


def team_url(child: Child) -> str:
    return f"/api/children/{child.id}/therapists"


def invite(client: TestClient, child: Child, headers: dict[str, str], email: str) -> dict[str, Any]:
    response = client.post(team_url(child), json={"email": email}, headers=headers)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def test_full_invitation_flow(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    mailbox: RecordingEmailSender,
) -> None:
    parent_headers, therapist_headers = auth_headers(parent), auth_headers(therapist)

    link = invite(db_client, child, parent_headers, "Dr.Raza@Clinic.example")
    assert link["status"] == "pending"
    assert link["therapist"]["email"] == "dr.raza@clinic.example"
    assert (
        mailbox.to(therapist.email)[-1].subject == "Sara Khan invited you to follow Ali on HearMate"
    )

    # Before accepting, the therapist sees the invitation but not the child's data.
    pending = db_client.get(LINKS, headers=therapist_headers).json()
    assert pending[0]["child"]["display_name"] == "Ali"
    assert "notes" not in pending[0]["child"]
    assert pending[0]["parent"] == {"first_name": "Sara", "last_name": "Khan"}
    assert db_client.get(f"/api/children/{child.id}", headers=therapist_headers).status_code == 404

    accepted = db_client.post(f"{LINKS}/{link['id']}/accept", headers=therapist_headers)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "active"
    assert mailbox.to(parent.email)[-1].subject == "Ali Raza is now following Ali on HearMate"
    assert db_client.get(f"/api/children/{child.id}", headers=therapist_headers).status_code == 200

    team = db_client.get(team_url(child), headers=parent_headers).json()
    assert [(t["status"], t["therapist"]["last_name"]) for t in team] == [("active", "Raza")]
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert {"therapist_invited", "therapist_link_accepted"} <= set(actions)


def test_inviting_requires_a_registered_active_therapist(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    other_parent = make_user(db_session)

    for email in ("nobody@example.com", other_parent.email):
        response = db_client.post(
            team_url(child), json={"email": email}, headers=auth_headers(parent)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "therapist_not_found"


def test_a_therapist_cannot_be_invited_twice(
    db_client: TestClient, parent: User, child: Child, therapist: User, auth_headers: AuthHeaders
) -> None:
    invite(db_client, child, auth_headers(parent), therapist.email)

    response = db_client.post(
        team_url(child), json={"email": therapist.email}, headers=auth_headers(parent)
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "already_linked"


def test_unapproved_therapists_cannot_accept_yet(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    pending_therapist = make_therapist(db_session, status=TherapistApprovalStatus.PENDING)
    link = invite(db_client, child, auth_headers(parent), pending_therapist.email)

    response = db_client.post(
        f"{LINKS}/{link['id']}/accept", headers=auth_headers(pending_therapist)
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "therapist_not_approved"


def test_accepting_twice_is_a_conflict(
    db_client: TestClient, parent: User, child: Child, therapist: User, auth_headers: AuthHeaders
) -> None:
    link = invite(db_client, child, auth_headers(parent), therapist.email)
    url = f"{LINKS}/{link['id']}/accept"
    db_client.post(url, headers=auth_headers(therapist))

    response = db_client.post(url, headers=auth_headers(therapist))

    assert response.status_code == 409


def test_therapists_cannot_touch_other_therapists_links(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    link = invite(db_client, child, auth_headers(parent), therapist.email)
    other = make_therapist(db_session)

    assert (
        db_client.post(f"{LINKS}/{link['id']}/accept", headers=auth_headers(other)).status_code
        == 404
    )
    assert db_client.delete(f"{LINKS}/{link['id']}", headers=auth_headers(other)).status_code == 404


def test_parent_removes_a_therapist_and_access_ends(
    db_client: TestClient,
    parent: User,
    child: Child,
    therapist: User,
    db_session: Session,
    auth_headers: AuthHeaders,
) -> None:
    link = link_therapist(db_session, therapist, child)
    assert (
        db_client.get(f"/api/children/{child.id}", headers=auth_headers(therapist)).status_code
        == 200
    )

    response = db_client.delete(f"{team_url(child)}/{link.id}", headers=auth_headers(parent))

    assert response.status_code == 204
    assert (
        db_client.get(f"/api/children/{child.id}", headers=auth_headers(therapist)).status_code
        == 404
    )
    assert db_client.get(team_url(child), headers=auth_headers(parent)).json() == []
    # A removed therapist can be invited again later.
    assert invite(db_client, child, auth_headers(parent), therapist.email)["status"] == "pending"


def test_therapist_can_decline_or_leave(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    link = link_therapist(db_session, therapist, child)

    response = db_client.delete(f"{LINKS}/{link.id}", headers=auth_headers(therapist))

    assert response.status_code == 204
    db_session.refresh(link)
    assert link.status is TherapistLinkStatus.REVOKED
    assert db_client.get(LINKS, headers=auth_headers(therapist)).json() == []


def test_care_team_endpoints_check_roles_and_ownership(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    stranger = make_user(db_session)

    assert db_client.get(team_url(child), headers=auth_headers(stranger)).status_code == 404
    assert (
        db_client.post(
            team_url(child), json={"email": therapist.email}, headers=auth_headers(stranger)
        ).status_code
        == 404
    )
    assert db_client.get(team_url(child), headers=auth_headers(therapist)).status_code == 403
    assert db_client.get(LINKS, headers=auth_headers(stranger)).status_code == 403
    assert db_client.get(LINKS, headers=auth_headers(child)).status_code == 403
