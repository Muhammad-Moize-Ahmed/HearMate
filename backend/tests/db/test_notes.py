from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Child,
    TherapistApprovalStatus,
    TherapistChildLink,
    TherapistLinkStatus,
    TherapistNote,
    User,
    UserRole,
)
from tests.conftest import AuthHeaders
from tests.factories import (
    link_therapist,
    make_child,
    make_linked_therapist,
    make_therapist,
    make_user,
)


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent)


@pytest.fixture
def therapist(db_session: Session, child: Child) -> User:
    therapist = make_therapist(db_session, first_name="Sara", last_name="Khan")
    link_therapist(db_session, therapist, child)
    return therapist


def notes_url(child: Child) -> str:
    return f"/api/children/{child.id}/notes"


def write_note(
    client: TestClient, child: Child, headers: dict[str, str], body: str = "Good focus today"
) -> dict[str, object]:
    response = client.post(notes_url(child), json={"body": body}, headers=headers)
    assert response.status_code == 201, response.text
    result: dict[str, object] = response.json()
    return result


def test_a_linked_therapist_writes_a_note(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    note = write_note(db_client, child, auth_headers(therapist), body="  Struggles with /th/  ")

    assert note["body"] == "Struggles with /th/"
    assert note["child_id"] == str(child.id)
    assert note["author"] == {"id": str(therapist.id), "first_name": "Sara", "last_name": "Khan"}
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "therapist_note_created")
    ).one()
    assert audit.actor_user_id == therapist.id
    assert audit.child_id == child.id


def test_the_parent_and_linked_therapists_read_notes_newest_first(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    colleague = make_therapist(db_session)
    link_therapist(db_session, colleague, child)
    write_note(db_client, child, auth_headers(therapist), body="first")
    write_note(db_client, child, auth_headers(colleague), body="second")

    for reader in (parent, therapist, colleague):
        response = db_client.get(notes_url(child), headers=auth_headers(reader))
        assert response.status_code == 200
        assert [n["body"] for n in response.json()] == ["second", "first"]


def test_therapist_reads_are_audited_but_parent_reads_are_not(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    db_client.get(notes_url(child), headers=auth_headers(parent))
    db_client.get(notes_url(child), headers=auth_headers(therapist))

    views = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "therapist_notes_viewed")
    ).all()
    assert [v.actor_user_id for v in views] == [therapist.id]


def test_notes_are_paged_with_limit_and_before(
    db_client: TestClient, parent: User, child: Child, therapist: User, auth_headers: AuthHeaders
) -> None:
    for i in range(3):
        write_note(db_client, child, auth_headers(therapist), body=f"note {i}")

    first = db_client.get(f"{notes_url(child)}?limit=2", headers=auth_headers(parent)).json()
    assert [n["body"] for n in first] == ["note 2", "note 1"]
    rest = db_client.get(
        notes_url(child),
        params={"limit": 2, "before": first[-1]["created_at"]},
        headers=auth_headers(parent),
    ).json()
    assert [n["body"] for n in rest] == ["note 0"]


@pytest.mark.parametrize(
    "body",
    [{"body": ""}, {"body": "   "}, {"body": "x" * 5001}, {"body": "ok", "therapist_id": "x"}, {}],
    ids=["empty", "blank", "too-long", "unknown-field", "missing"],
)
def test_invalid_notes_are_rejected(
    db_client: TestClient,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    body: dict[str, object],
) -> None:
    response = db_client.post(notes_url(child), json=body, headers=auth_headers(therapist))

    assert response.status_code == 422


# Builds the account making the request. 403 = sees the child but may not do this; 404 = can't
# see the child at all.
Maker = Callable[[Session, Child], User | Child]


def _parent_of(session: Session, child: Child) -> User:
    parent = session.get(User, child.parent_id)
    assert parent is not None
    return parent


@pytest.mark.parametrize(
    ("make_account", "expected"),
    [
        (_parent_of, 403),
        (lambda s, c: c, 403),
        (lambda s, c: make_user(s), 404),
        (lambda s, c: make_user(s, role=UserRole.ADMIN), 404),
        (lambda s, c: make_therapist(s), 404),
        (
            lambda s, c: make_linked_therapist(
                s, c, TherapistLinkStatus.PENDING, TherapistApprovalStatus.APPROVED
            ),
            404,
        ),
        (
            lambda s, c: make_linked_therapist(
                s, c, TherapistLinkStatus.REVOKED, TherapistApprovalStatus.APPROVED
            ),
            404,
        ),
        (
            lambda s, c: make_linked_therapist(
                s, c, TherapistLinkStatus.ACTIVE, TherapistApprovalStatus.PENDING
            ),
            404,
        ),
    ],
    ids=[
        "parent",
        "child",
        "other-parent",
        "admin",
        "unlinked-therapist",
        "invited-therapist",
        "revoked-therapist",
        "unapproved-therapist",
    ],
)
def test_only_linked_approved_therapists_can_write_notes(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    auth_headers: AuthHeaders,
    make_account: Maker,
    expected: int,
) -> None:
    account = make_account(db_session, child)

    response = db_client.post(notes_url(child), json={"body": "x"}, headers=auth_headers(account))

    assert response.status_code == expected
    assert db_session.scalars(select(TherapistNote)).all() == []


@pytest.mark.parametrize(
    ("make_account", "expected"),
    [
        (lambda s, c: c, 403),
        (lambda s, c: make_user(s), 404),
        (lambda s, c: make_user(s, role=UserRole.ADMIN), 404),
        (lambda s, c: make_therapist(s), 404),
        (
            lambda s, c: make_linked_therapist(
                s, c, TherapistLinkStatus.ACTIVE, TherapistApprovalStatus.PENDING
            ),
            404,
        ),
    ],
    ids=["child", "other-parent", "admin", "unlinked-therapist", "unapproved-therapist"],
)
def test_outsiders_cannot_read_notes(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    make_account: Maker,
    expected: int,
) -> None:
    write_note(db_client, child, auth_headers(therapist))
    account = make_account(db_session, child)

    response = db_client.get(notes_url(child), headers=auth_headers(account))

    assert response.status_code == expected


def test_notes_need_a_token(db_client: TestClient, child: Child) -> None:
    assert db_client.get(notes_url(child)).status_code == 401
    assert db_client.post(notes_url(child), json={"body": "x"}).status_code == 401


def test_the_author_edits_and_deletes_their_note(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    note = write_note(db_client, child, auth_headers(therapist))
    url = f"{notes_url(child)}/{note['id']}"

    updated = db_client.patch(url, json={"body": "Revised"}, headers=auth_headers(therapist))
    assert updated.status_code == 200
    assert updated.json()["body"] == "Revised"
    assert updated.json()["created_at"] == note["created_at"]

    assert db_client.delete(url, headers=auth_headers(therapist)).status_code == 204
    assert db_client.get(notes_url(child), headers=auth_headers(parent)).json() == []
    actions = db_session.scalars(
        select(AuditLog.action).where(AuditLog.resource_type == "therapist_note")
    ).all()
    assert {"therapist_note_updated", "therapist_note_deleted"} <= set(actions)


def test_other_therapists_and_the_parent_cannot_change_a_note(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    note = write_note(db_client, child, auth_headers(therapist))
    url = f"{notes_url(child)}/{note['id']}"
    colleague = make_therapist(db_session)
    link_therapist(db_session, colleague, child)

    response = db_client.patch(url, json={"body": "x"}, headers=auth_headers(colleague))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "not_note_author"
    assert db_client.delete(url, headers=auth_headers(colleague)).status_code == 403
    assert db_client.patch(url, json={"body": "x"}, headers=auth_headers(parent)).status_code == 403
    assert db_client.delete(url, headers=auth_headers(parent)).status_code == 403
    assert db_session.scalars(select(TherapistNote.body)).one() == "Good focus today"


def test_a_removed_therapist_loses_access_but_their_notes_stay(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    note = write_note(db_client, child, auth_headers(therapist))
    link = db_session.scalars(
        select(TherapistChildLink).where(TherapistChildLink.therapist_id == therapist.id)
    ).one()
    link.status = TherapistLinkStatus.REVOKED
    db_session.flush()

    url = f"{notes_url(child)}/{note['id']}"
    assert (
        db_client.patch(url, json={"body": "x"}, headers=auth_headers(therapist)).status_code == 404
    )
    assert db_client.get(notes_url(child), headers=auth_headers(therapist)).status_code == 404
    parent_view = db_client.get(notes_url(child), headers=auth_headers(parent)).json()
    assert [n["id"] for n in parent_view] == [note["id"]]


def test_a_note_is_only_reachable_through_its_own_child(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    sibling = make_child(db_session, parent)
    link_therapist(db_session, therapist, sibling)
    note = write_note(db_client, sibling, auth_headers(therapist))

    response = db_client.patch(
        f"{notes_url(child)}/{note['id']}", json={"body": "x"}, headers=auth_headers(therapist)
    )

    assert response.status_code == 404
