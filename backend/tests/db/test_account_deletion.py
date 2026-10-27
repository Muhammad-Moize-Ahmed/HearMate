"""Deleting a parent's account (the whole family), one child, or a therapist's account.

Each deletion is checked against the whole database: every table's row count goes back to what
it was before the deleted person's data existed, and no row anywhere contains their id, email,
names, username or IP address (`tests/residue.py`).
"""

import secrets
import string
import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Child,
    LearningPlan,
    LevelHistory,
    SkillCategory,
    TherapistChildLink,
    TherapistNote,
    User,
    UserRole,
)
from app.modules.games.catalogue import sync_games
from tests.conftest import AuthHeaders
from tests.factories import DEFAULT_PASSWORD, DEFAULT_PIN, make_child, make_therapist, make_user
from tests.fakes import RecordingEmailSender
from tests.gameplay import play_game
from tests.residue import grown, row_counts, traces

FAMILY_IP = "203.0.113.9"
THERAPIST_IP = "198.51.100.4"
DELETE_ACCOUNT = "/api/account/delete"
SUMMARY = "/api/account/deletion-summary"

# Every table except the game catalogue and the therapists' profiles (made before the family).
FAMILY_TABLES = {
    "users",
    "refresh_tokens",
    "one_time_codes",
    "children",
    "therapist_child_links",
    "therapist_notes",
    "learning_plans",
    "learning_plan_items",
    "game_sessions",
    "session_rounds",
    "speech_attempts",
    "skill_levels",
    "level_history",
    "goals",
    "achievements",
    "daily_activity",
    "audit_log",
}


def token() -> str:
    """Letters only, unlikely to appear anywhere by chance (names are matched as text)."""
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(10))


def device(app: FastAPI, ip: str) -> TestClient:
    """One browser: its own cookie jar (refresh token) and IP address."""
    return TestClient(app, client=(ip, 50000))


def password_login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


@dataclass(frozen=True)
class Adult:
    """What we know about an account, kept after its row is gone."""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str

    @classmethod
    def of(cls, user: User) -> "Adult":
        return cls(user.id, user.email, user.first_name, user.last_name)


@dataclass(frozen=True)
class Kid:
    id: uuid.UUID
    display_name: str


@dataclass
class Family:
    parent: Adult
    children: list[Kid]
    username: str
    parent_device: TestClient
    child_device: TestClient
    therapist_device: TestClient
    parent_headers: dict[str, str]
    child_headers: dict[str, str]
    therapist_headers: dict[str, str]
    therapist: Adult  # linked to the first child, invited to the second
    other_therapist_id: uuid.UUID  # invited to the second child only
    control_child_id: uuid.UUID  # another family's: must never change
    baseline: dict[str, int]  # row counts before the family existed


@pytest.fixture
def family(app: FastAPI, db_client: TestClient, db_session: Session) -> Family:
    sync_games(db_session)
    # Made before the baseline: they outlive the family.
    therapist = make_therapist(
        db_session,
        password=DEFAULT_PASSWORD,
        first_name=f"T{token()}",
        last_name=f"T{token()}",
        email=f"therapist-{token()}@example.com",
    )
    other_therapist = make_therapist(db_session)
    control_parent = make_user(db_session)
    control_child = make_child(db_session, control_parent, display_name="Control")
    therapist_device = device(app, THERAPIST_IP)
    therapist_headers = password_login(therapist_device, therapist.email)
    baseline = row_counts(db_session)

    parent = make_user(
        db_session,
        password=DEFAULT_PASSWORD,
        first_name=f"P{token()}",
        last_name=f"P{token()}",
        email=f"family-{token()}@example.com",
    )
    parent_device = device(app, FAMILY_IP)
    parent_headers = password_login(parent_device, parent.email)
    ok(parent_device.post("/api/auth/password/forgot", json={"email": parent.email}), 202)

    children: list[Child] = []
    for _ in range(2):
        body = {"display_name": f"K{token()}", "date_of_birth": "2018-05-01"}
        created = ok(parent_device.post("/api/children", json=body, headers=parent_headers), 201)
        child = db_session.get(Child, created["id"])
        assert child is not None
        children.append(child)
    first, second = children
    username = f"k{token()}"
    ok(
        parent_device.put(
            f"/api/children/{first.id}/login",
            json={"username": username, "pin": DEFAULT_PIN},
            headers=parent_headers,
        )
    )
    child_device = device(app, FAMILY_IP)
    child_login = child_device.post(
        "/api/auth/child-login", json={"username": username, "pin": DEFAULT_PIN}
    )
    child_headers = {"Authorization": f"Bearer {ok(child_login)['access_token']}"}
    ok(
        parent_device.post(
            f"/api/children/{first.id}/goals",
            json={"title": "Play every day", "target_value": 5},
            headers=parent_headers,
        ),
        201,
    )

    def invite(child: Child, who: User) -> str:
        link = parent_device.post(
            f"/api/children/{child.id}/therapists",
            json={"email": who.email},
            headers=parent_headers,
        )
        return str(ok(link, 201)["id"])

    link_id = invite(first, therapist)
    invite(second, therapist)
    invite(second, other_therapist)
    ok(therapist_device.post(f"/api/therapist/links/{link_id}/accept", headers=therapist_headers))

    for game in ("similar-sounds", "speech-practice"):
        play_game(child_device, db_session, child_headers, first, game)
    db_session.add(  # level changes need several sessions; one row is enough here
        LevelHistory(
            child_id=first.id,
            category=SkillCategory.MEMORY,
            old_level=1,
            new_level=2,
            reason="test",
        )
    )
    db_session.flush()

    child_url = f"/api/children/{first.id}"
    ok(
        therapist_device.post(
            f"{child_url}/notes", json={"body": "Responds well to cues."}, headers=therapist_headers
        ),
        201,
    )
    plan = {"title": "Term 1", "items": [{"game": "similar-sounds", "sessions_per_week": 2}]}
    ok(
        therapist_device.post(f"{child_url}/learning-plans", json=plan, headers=therapist_headers),
        201,
    )
    ok(therapist_device.get(f"{child_url}/report", headers=therapist_headers))

    family = Family(
        parent=Adult.of(parent),
        children=[Kid(c.id, c.display_name) for c in children],
        username=username,
        parent_device=parent_device,
        child_device=child_device,
        therapist_device=therapist_device,
        parent_headers=parent_headers,
        child_headers=child_headers,
        therapist_headers=therapist_headers,
        therapist=Adult.of(therapist),
        other_therapist_id=other_therapist.id,
        control_child_id=control_child.id,
        baseline=baseline,
    )
    # The setup must really touch every table, or the checks below would prove little.
    assert grown(baseline, row_counts(db_session)) == FAMILY_TABLES
    return family


def family_needles(family: Family) -> list[object]:
    parent = family.parent
    return [
        parent.id,
        parent.email,
        parent.first_name,
        parent.last_name,
        family.username,
        FAMILY_IP,
        *[c.id for c in family.children],
        *[c.display_name for c in family.children],
    ]


def therapist_needles(family: Family) -> list[object]:
    t = family.therapist
    return [t.id, t.email, t.first_name, t.last_name, THERAPIST_IP]


def found_everywhere_first(db: Session, needles: list[object]) -> None:
    """The scan can only prove absence if it finds every needle before the deletion."""
    assert {n for _, n in traces(db, needles)} == {str(n).lower() for n in needles}


def delete_account(client: TestClient, headers: dict[str, str], password: str) -> Any:
    return client.post(DELETE_ACCOUNT, json={"password": password}, headers=headers)


def gone(client: TestClient, headers: dict[str, str]) -> bool:
    """Neither the access token nor this device's refresh cookie works any more."""
    return (
        client.get("/api/auth/me", headers=headers).status_code == 401
        and client.post("/api/auth/refresh").status_code == 401
    )


# ---------------------------------------------------------------- parent: the whole family


def test_a_parent_deletes_the_family_and_nothing_of_it_is_left(
    family: Family, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    found_everywhere_first(db_session, family_needles(family))
    wrong = delete_account(family.parent_device, family.parent_headers, "not-my-password")
    assert wrong.status_code == 403
    assert wrong.json()["error"]["code"] == "wrong_password"
    assert db_session.get(User, family.parent.id) is not None

    response = delete_account(family.parent_device, family.parent_headers, DEFAULT_PASSWORD)

    assert response.status_code == 204
    assert 'hm_refresh=""' in response.headers["set-cookie"]
    assert response.headers["cache-control"] == "no-store"
    db_session.expire_all()
    assert traces(db_session, family_needles(family)) == []
    # Back to the baseline, apart from one anonymous record that a family was deleted.
    expected = family.baseline | {"audit_log": family.baseline["audit_log"] + 1}
    assert row_counts(db_session) == expected
    event = db_session.scalars(select(AuditLog).where(AuditLog.action == "account_deleted")).one()
    assert (event.actor_user_id, event.ip_address, event.resource_id) == (None, None, None)
    assert event.details == {"role": "parent", "children": 2}
    # Every device is signed out: the parent's and the child's.
    assert gone(family.parent_device, family.parent_headers)
    assert gone(family.child_device, family.child_headers)
    # Nobody else's data changed.
    assert db_session.get(Child, family.control_child_id) is not None
    assert db_session.get(User, family.therapist.id) is not None

    sent = [m for m in mailbox.sent if m.to == family.parent.email]
    assert [m.subject for m in sent][-1] == "Your HearMate account was deleted"
    assert "2 child profiles" in sent[-1].body
    assert not any(c.display_name in sent[-1].body for c in family.children)


def test_the_email_can_sign_up_again_after_deletion(family: Family, db_client: TestClient) -> None:
    ok(delete_account(family.parent_device, family.parent_headers, DEFAULT_PASSWORD), 204)

    body = {
        "email": family.parent.email,
        "password": "a-brand-new-password",
        "first_name": "New",
        "last_name": "Start",
    }
    assert db_client.post("/api/auth/signup", json=body).status_code == 202


# ---------------------------------------------------------------- parent: one child


def test_a_parent_deletes_one_child_and_nothing_of_that_child_is_left(
    family: Family, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    first, second = family.children
    found_everywhere_first(db_session, [first.id, first.display_name, family.username])
    url = f"/api/children/{first.id}/delete"
    wrong = family.parent_device.post(url, json={"password": "nope"}, headers=family.parent_headers)
    assert wrong.status_code == 403
    assert wrong.json()["error"]["code"] == "wrong_password"

    response = family.parent_device.post(
        url, json={"password": DEFAULT_PASSWORD}, headers=family.parent_headers
    )

    assert response.status_code == 204
    db_session.expire_all()
    assert traces(db_session, [first.id, first.display_name, family.username]) == []
    assert db_session.get(Child, second.id) is not None
    assert db_session.get(User, family.parent.id) is not None
    # The second child's invitations are untouched; the first child's links went with them.
    links = db_session.scalars(select(TherapistChildLink.child_id)).all()
    assert set(links) == {second.id}
    event = db_session.scalars(select(AuditLog).where(AuditLog.action == "child_deleted")).one()
    assert (event.actor_user_id, event.child_id, event.resource_id) == (
        family.parent.id,
        None,
        None,
    )
    assert event.details == {}
    # The child is signed out everywhere; the parent isn't.
    assert gone(family.child_device, family.child_headers)
    assert (
        family.parent_device.get("/api/auth/me", headers=family.parent_headers).status_code == 200
    )

    sent = mailbox.sent[-1]
    assert sent.to == family.parent.email
    assert sent.subject == "A child profile was deleted from your HearMate account"
    assert "You now have 1 child profile." in sent.body
    assert first.display_name not in sent.body


def test_only_the_childs_own_parent_can_delete_them(
    family: Family, db_client: TestClient, db_session: Session, auth_headers: AuthHeaders
) -> None:
    url = f"/api/children/{family.children[0].id}/delete"
    body = {"password": DEFAULT_PASSWORD}
    stranger = make_user(db_session, password=DEFAULT_PASSWORD)

    assert db_client.post(url, json=body).status_code == 401
    assert db_client.post(url, json=body, headers=auth_headers(stranger)).status_code == 404
    assert db_client.post(url, json=body, headers=family.therapist_headers).status_code == 403
    assert db_client.post(url, json=body, headers=family.child_headers).status_code == 403
    assert db_session.get(Child, family.children[0].id) is not None


def test_the_old_delete_endpoint_is_gone(family: Family, db_client: TestClient) -> None:
    url = f"/api/children/{family.children[0].id}"

    assert db_client.delete(url, headers=family.parent_headers).status_code == 405


# ---------------------------------------------------------------- therapist


def test_a_therapist_deletes_their_account_and_their_notes_stay_with_the_child(
    family: Family, db_session: Session, mailbox: RecordingEmailSender
) -> None:
    first, second = family.children
    therapist = family.therapist
    name = f"{therapist.first_name} {therapist.last_name}"
    found_everywhere_first(db_session, therapist_needles(family))

    response = delete_account(family.therapist_device, family.therapist_headers, DEFAULT_PASSWORD)

    assert response.status_code == 204
    db_session.expire_all()
    # Nothing names them: not even the audit rows kept for the family, nor their name, which
    # went out in the parents' email only.
    assert traces(db_session, therapist_needles(family)) == []
    assert gone(family.therapist_device, family.therapist_headers)
    # Their links and invitations ended; the other therapist's invitation didn't.
    links = db_session.scalars(select(TherapistChildLink.therapist_id)).all()
    assert links == [family.other_therapist_id]
    # Notes and plans stay with the child, by a former therapist.
    note = db_session.scalars(select(TherapistNote)).one()
    assert (note.child_id, note.therapist_id) == (first.id, None)
    assert db_session.scalars(select(LearningPlan.created_by_id)).all() == [None]
    notes = ok(
        family.parent_device.get(f"/api/children/{first.id}/notes", headers=family.parent_headers)
    )
    assert [(n["body"], n["author"]) for n in notes] == [("Responds well to cues.", None)]
    plans = ok(
        family.parent_device.get(
            f"/api/children/{first.id}/learning-plans", headers=family.parent_headers
        )
    )
    assert [p["created_by"] for p in plans] == [None]
    # The family keeps a record that someone (no longer named) saw and wrote about the child.
    kept = db_session.scalars(select(AuditLog).where(AuditLog.child_id == first.id)).all()
    by_former = [e for e in kept if e.actor_type.value == "user" and e.actor_user_id is None]
    assert {e.action for e in by_former} >= {"therapist_note_created", "child_report_viewed"}
    assert all(e.ip_address is None for e in by_former)

    to_therapist = [m for m in mailbox.sent if m.to == therapist.email][-1]
    assert to_therapist.subject == "Your HearMate therapist account was deleted"
    assert "2 children" in to_therapist.body
    to_parent = [m for m in mailbox.sent if m.to == family.parent.email][-1]
    assert to_parent.subject == "A therapist left your child's care team"
    assert name not in to_parent.subject  # failed sends are logged by subject
    assert name in to_parent.body
    assert "2 of your children's" in to_parent.body
    assert db_session.get(Child, second.id) is not None


def test_admin_counts_follow_deletions(
    family: Family, db_client: TestClient, db_session: Session, auth_headers: AuthHeaders
) -> None:
    admin = auth_headers(make_user(db_session, role=UserRole.ADMIN))
    before = ok(db_client.get("/api/admin/stats", headers=admin))

    ok(delete_account(family.therapist_device, family.therapist_headers, DEFAULT_PASSWORD), 204)
    ok(delete_account(family.parent_device, family.parent_headers, DEFAULT_PASSWORD), 204)

    after = ok(db_client.get("/api/admin/stats", headers=admin))
    assert after["therapists"]["total"] == before["therapists"]["total"] - 1
    assert after["parents"] == before["parents"] - 1
    assert after["children"] == before["children"] - 2


# ---------------------------------------------------------------- who, how often


def test_admins_and_children_cannot_delete_accounts(
    family: Family, db_client: TestClient, db_session: Session, auth_headers: AuthHeaders
) -> None:
    admin_user = make_user(db_session, role=UserRole.ADMIN, password=DEFAULT_PASSWORD)
    body = {"password": DEFAULT_PASSWORD}

    assert db_client.post(DELETE_ACCOUNT, json=body).status_code == 401
    for headers in (auth_headers(admin_user), family.child_headers):
        assert db_client.post(DELETE_ACCOUNT, json=body, headers=headers).status_code == 403
        assert db_client.get(SUMMARY, headers=headers).status_code == 403
    assert db_session.get(User, admin_user.id) is not None


def test_wrong_passwords_lock_deletion_like_login(family: Family, db_session: Session) -> None:
    for _ in range(5):
        response = delete_account(family.parent_device, family.parent_headers, "wrong-password")
        assert response.status_code == 403

    blocked = delete_account(family.parent_device, family.parent_headers, DEFAULT_PASSWORD)

    assert blocked.status_code == 429
    assert db_session.get(User, family.parent.id) is not None


def test_the_summary_says_what_will_go(family: Family) -> None:
    as_parent = ok(family.parent_device.get(SUMMARY, headers=family.parent_headers))
    as_therapist = ok(family.therapist_device.get(SUMMARY, headers=family.therapist_headers))

    assert as_parent == {
        "role": "parent",
        "children": sorted(c.display_name for c in family.children),
        "games_played": 2,
        "therapists": 2,
    }
    assert as_therapist == {
        "role": "therapist",
        "linked_children": 2,
        "notes": 1,
        "learning_plans": 1,
    }
