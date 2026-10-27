from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.passwords import hash_secret
from app.db.models import (
    AuditLog,
    Child,
    Game,
    LearningPlan,
    SkillCategory,
    TherapistApprovalStatus,
    TherapistLinkStatus,
    User,
    UserRole,
)
from tests.conftest import AuthHeaders
from tests.factories import (
    DEFAULT_PASSWORD,
    link_therapist,
    make_child,
    make_game,
    make_linked_therapist,
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
    return make_linked_therapist(db_session, child, first_name="Sara", last_name="Khan")


@pytest.fixture
def games(db_session: Session) -> dict[str, Game]:
    return {
        "detective": make_game(db_session, title="Sound Detective", sort_order=1),
        "speech": make_game(
            db_session, title="Speech Practice", category=SkillCategory.SPEECH, sort_order=2
        ),
    }


def plans_url(child: Child) -> str:
    return f"/api/children/{child.id}/learning-plans"


def plan_body(games: dict[str, Game], **overrides: Any) -> dict[str, Any]:
    return {
        "title": "Term 1",
        "notes": "Focus on listening in quiet first.",
        "items": [
            {"game": games["speech"].slug, "sessions_per_week": 2, "notes": "Short words"},
            {"game": games["detective"].slug, "sessions_per_week": 3, "difficulty": "easy"},
        ],
    } | overrides


def create_plan(
    client: TestClient, child: Child, headers: dict[str, str], body: dict[str, Any]
) -> dict[str, Any]:
    response = client.post(plans_url(child), json=body, headers=headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def test_a_linked_therapist_creates_a_plan(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    games: dict[str, Game],
    auth_headers: AuthHeaders,
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), plan_body(games))

    assert plan["title"] == "Term 1"
    assert plan["is_active"] is True
    assert plan["created_by"] == {
        "id": str(therapist.id),
        "first_name": "Sara",
        "last_name": "Khan",
    }
    # Items come back in catalogue order, with the game's public details.
    assert [
        (i["game"]["title"], i["sessions_per_week"], i["difficulty"]) for i in plan["items"]
    ] == [
        ("Sound Detective", 3, "easy"),
        ("Speech Practice", 2, None),
    ]
    assert plan["items"][1]["game"]["category"] == "speech"
    assert plan["items"][1]["notes"] == "Short words"
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "learning_plan_created")
    ).one()
    assert (audit.actor_user_id, audit.child_id) == (therapist.id, child.id)


def test_a_plan_can_start_with_no_games(
    db_client: TestClient, child: Child, therapist: User, auth_headers: AuthHeaders
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "To be decided"})

    assert plan["items"] == []
    assert plan["notes"] is None


def test_a_new_plan_archives_the_previous_one(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    games: dict[str, Game],
    auth_headers: AuthHeaders,
) -> None:
    headers = auth_headers(therapist)
    first = create_plan(db_client, child, headers, plan_body(games, title="Term 1"))
    second = create_plan(db_client, child, headers, plan_body(games, title="Term 2"))

    plans = db_client.get(plans_url(child), headers=auth_headers(parent)).json()
    assert [(p["title"], p["is_active"]) for p in plans] == [("Term 2", True), ("Term 1", False)]
    active = db_client.get(f"{plans_url(child)}/active", headers=auth_headers(parent)).json()
    assert active["id"] == second["id"]
    archived = db_client.get(f"{plans_url(child)}/{first['id']}", headers=auth_headers(parent))
    assert len(archived.json()["items"]) == 2  # history keeps its items
    details = db_session.scalars(
        select(AuditLog.details).where(
            AuditLog.action == "learning_plan_created", AuditLog.resource_id == second["id"]
        )
    ).one()
    assert details == {"replaced_plan_id": first["id"]}


def test_plans_can_be_filtered_by_active(
    db_client: TestClient,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    headers = auth_headers(therapist)
    create_plan(db_client, child, headers, {"title": "Old"})
    create_plan(db_client, child, headers, {"title": "New"})

    def titles(active: str) -> list[str]:
        response = db_client.get(
            plans_url(child), params={"active": active}, headers=auth_headers(parent)
        )
        return [p["title"] for p in response.json()]

    assert titles("true") == ["New"]
    assert titles("false") == ["Old"]


def test_no_active_plan_is_a_404_with_its_own_code(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders
) -> None:
    response = db_client.get(f"{plans_url(child)}/active", headers=auth_headers(parent))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "no_active_plan"
    assert db_client.get(plans_url(child), headers=auth_headers(parent)).json() == []


def test_the_active_plan_can_be_edited(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    games: dict[str, Game],
    auth_headers: AuthHeaders,
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), plan_body(games))
    url = f"{plans_url(child)}/{plan['id']}"

    renamed = db_client.patch(
        url, json={"title": "Term 1 (revised)"}, headers=auth_headers(therapist)
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Term 1 (revised)"
    assert len(renamed.json()["items"]) == 2  # untouched when not sent

    replaced = db_client.patch(
        url,
        json={"notes": None, "items": [{"game": games["speech"].slug, "sessions_per_week": 5}]},
        headers=auth_headers(therapist),
    ).json()
    assert replaced["notes"] is None
    assert [(i["game"]["slug"], i["sessions_per_week"]) for i in replaced["items"]] == [
        (games["speech"].slug, 5)
    ]
    changed = db_session.scalars(
        select(AuditLog.details).where(
            AuditLog.action == "learning_plan_updated", AuditLog.resource_id == plan["id"]
        )
    ).all()
    assert sorted(d["fields"] for d in changed) == [["items", "notes"], ["title"]]


def test_any_linked_therapist_can_edit_the_childs_plan(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "Shared"})
    colleague = make_linked_therapist(db_session, child)

    response = db_client.patch(
        f"{plans_url(child)}/{plan['id']}",
        json={"title": "Edited"},
        headers=auth_headers(colleague),
    )

    assert response.status_code == 200
    assert response.json()["created_by"]["id"] == str(therapist.id)


def test_archived_plans_are_read_only(
    db_client: TestClient, child: Child, therapist: User, auth_headers: AuthHeaders
) -> None:
    headers = auth_headers(therapist)
    plan = create_plan(db_client, child, headers, {"title": "Term 1"})
    url = f"{plans_url(child)}/{plan['id']}"

    archived = db_client.post(f"{url}/archive", headers=headers)
    assert archived.status_code == 200
    assert archived.json()["is_active"] is False

    for response in (
        db_client.patch(url, json={"title": "x"}, headers=headers),
        db_client.post(f"{url}/archive", headers=headers),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "plan_archived"
    assert db_client.get(f"{plans_url(child)}/active", headers=headers).status_code == 404


@pytest.mark.parametrize("problem", ["unknown", "inactive"])
def test_plan_games_must_exist_and_be_active(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    games: dict[str, Game],
    auth_headers: AuthHeaders,
    problem: str,
) -> None:
    bad = make_game(db_session, is_active=False).slug if problem == "inactive" else "no-such-game"
    body = plan_body(games)
    body["items"].append({"game": bad, "sessions_per_week": 1})

    response = db_client.post(plans_url(child), json=body, headers=auth_headers(therapist))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "game_not_found"
    assert response.json()["error"]["details"] == {"games": [bad]}
    assert db_session.scalars(select(LearningPlan)).all() == []


def _items(n: int) -> list[dict[str, Any]]:
    return [{"game": f"game-{i}", "sessions_per_week": 1} for i in range(n)]


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"title": "x", "items": [{"game": "a", "sessions_per_week": 0}]},
        {"title": "x", "items": [{"game": "a", "sessions_per_week": 22}]},
        {"title": "x", "items": [{"game": "a", "sessions_per_week": 1, "difficulty": "extreme"}]},
        {"title": "x", "items": [{"game": "Not A Slug", "sessions_per_week": 1}]},
        {"title": "x", "items": _items(1) + _items(1)},
        {"title": "x", "items": _items(21)},
        {"title": "x", "is_active": False},
        {"title": "x", "items": [{"game": "a", "sessions_per_week": 1, "game_id": "x"}]},
    ],
    ids=[
        "blank-title",
        "long-title",
        "zero-sessions",
        "too-many-sessions",
        "bad-difficulty",
        "bad-slug",
        "duplicate-game",
        "too-many-items",
        "unknown-field",
        "unknown-item-field",
    ],
)
def test_invalid_plans_are_rejected(
    db_client: TestClient,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    body: dict[str, Any],
) -> None:
    response = db_client.post(plans_url(child), json=body, headers=auth_headers(therapist))

    assert response.status_code == 422


@pytest.mark.parametrize("body", [{"title": None}, {"items": None}], ids=["title", "items"])
def test_required_fields_cannot_be_cleared(
    db_client: TestClient,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    body: dict[str, Any],
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "Term 1"})

    response = db_client.patch(
        f"{plans_url(child)}/{plan['id']}", json=body, headers=auth_headers(therapist)
    )

    assert response.status_code == 422


# Builds the account making the request. 403 = sees the child but may not do this; 404 = can't
# see the child at all.
Maker = Callable[[Session, Child], User | Child]


def _parent_of(session: Session, child: Child) -> User:
    parent = session.get(User, child.parent_id)
    assert parent is not None
    return parent


NOT_MANAGERS: list[Any] = [
    pytest.param(_parent_of, 403, id="parent"),
    pytest.param(lambda s, c: c, 403, id="child"),
    pytest.param(lambda s, c: make_user(s), 404, id="other-parent"),
    pytest.param(lambda s, c: make_user(s, role=UserRole.ADMIN), 404, id="admin"),
    pytest.param(
        lambda s, c: make_linked_therapist(s, make_child(s, make_user(s))),
        404,
        id="unlinked-therapist",
    ),
    pytest.param(
        lambda s, c: make_linked_therapist(s, c, TherapistLinkStatus.PENDING),
        404,
        id="invited-therapist",
    ),
    pytest.param(
        lambda s, c: make_linked_therapist(s, c, TherapistLinkStatus.REVOKED),
        404,
        id="revoked-therapist",
    ),
    pytest.param(
        lambda s, c: make_linked_therapist(
            s, c, TherapistLinkStatus.ACTIVE, TherapistApprovalStatus.PENDING
        ),
        404,
        id="unapproved-therapist",
    ),
]


@pytest.mark.parametrize(("make_account", "expected"), NOT_MANAGERS)
def test_only_linked_approved_therapists_can_change_plans(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    make_account: Maker,
    expected: int,
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "Term 1"})
    url = f"{plans_url(child)}/{plan['id']}"
    headers = auth_headers(make_account(db_session, child))

    assert (
        db_client.post(plans_url(child), json={"title": "x"}, headers=headers).status_code
        == expected
    )
    assert db_client.patch(url, json={"title": "x"}, headers=headers).status_code == expected
    assert db_client.post(f"{url}/archive", headers=headers).status_code == expected
    plans = db_session.scalars(select(LearningPlan)).all()
    assert [(p.title, p.is_active) for p in plans] == [("Term 1", True)]


@pytest.mark.parametrize(
    ("make_account", "expected"),
    [p for p in NOT_MANAGERS if p.id not in {"parent", "invited-therapist", "revoked-therapist"}],
)
def test_outsiders_cannot_read_plans(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
    make_account: Maker,
    expected: int,
) -> None:
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "Term 1"})
    headers = auth_headers(make_account(db_session, child))

    for path in ("", "/active", f"/{plan['id']}"):
        assert db_client.get(f"{plans_url(child)}{path}", headers=headers).status_code == expected


def test_plans_need_a_token(db_client: TestClient, child: Child) -> None:
    assert db_client.get(plans_url(child)).status_code == 401
    assert db_client.post(plans_url(child), json={"title": "x"}).status_code == 401


def test_therapist_reads_are_audited_but_parent_reads_are_not(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    create_plan(db_client, child, auth_headers(therapist), {"title": "Term 1"})

    db_client.get(f"{plans_url(child)}/active", headers=auth_headers(parent))
    db_client.get(f"{plans_url(child)}/active", headers=auth_headers(therapist))

    views = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "learning_plans_viewed")
    ).all()
    assert [v.actor_user_id for v in views] == [therapist.id]


def test_a_plan_is_only_reachable_through_its_own_child(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    auth_headers: AuthHeaders,
) -> None:
    sibling = make_child(db_session, parent)
    link_therapist(db_session, therapist, sibling)
    plan = create_plan(db_client, child, auth_headers(therapist), {"title": "Term 1"})
    wrong_url = f"{plans_url(sibling)}/{plan['id']}"

    assert db_client.get(wrong_url, headers=auth_headers(parent)).status_code == 404
    for response in (
        db_client.patch(wrong_url, json={"title": "x"}, headers=auth_headers(therapist)),
        db_client.post(f"{wrong_url}/archive", headers=auth_headers(therapist)),
    ):
        assert response.status_code == 404


def test_deleting_the_child_removes_their_plans(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    therapist: User,
    games: dict[str, Game],
    auth_headers: AuthHeaders,
) -> None:
    create_plan(db_client, child, auth_headers(therapist), plan_body(games))

    parent.password_hash = hash_secret(DEFAULT_PASSWORD)
    response = db_client.post(
        f"/api/children/{child.id}/delete",
        json={"password": DEFAULT_PASSWORD},
        headers=auth_headers(parent),
    )
    assert response.status_code == 204
    assert db_session.scalars(select(LearningPlan)).all() == []
