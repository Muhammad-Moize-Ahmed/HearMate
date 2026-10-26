from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import Child, Goal, GoalStatus, User
from tests.conftest import AuthHeaders
from tests.factories import link_therapist, make_child, make_therapist, make_user


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent)


def goals_url(child: Child) -> str:
    return f"/api/children/{child.id}/goals"


def add_goal(db_session: Session, child: Child, **overrides: object) -> Goal:
    goal = Goal(child_id=child.id, **({"title": "Play 5 days", "target_value": 5} | overrides))
    db_session.add(goal)
    db_session.flush()
    return goal


def test_parent_creates_a_goal(
    db_client: TestClient, parent: User, child: Child, auth_headers: AuthHeaders
) -> None:
    due = (date.today() + timedelta(days=7)).isoformat()

    response = db_client.post(
        goals_url(child),
        json={
            "title": "5 listening sessions",
            "category": "listening",
            "target_value": 5,
            "due_date": due,
        },
        headers=auth_headers(parent),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["current_value"] == 0
    assert body["status"] == "active"
    assert body["due_date"] == due


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "target_value": 0},
        {"title": "", "target_value": 3},
        {"title": "x", "target_value": 3, "due_date": "2020-01-01"},
        {"title": "x", "target_value": 3, "current_value": 3},
    ],
    ids=["zero-target", "blank-title", "past-due", "progress-is-not-settable"],
)
def test_invalid_goals_are_rejected(
    db_client: TestClient,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
    body: dict[str, object],
) -> None:
    response = db_client.post(goals_url(child), json=body, headers=auth_headers(parent))

    assert response.status_code == 422


def test_everyone_who_can_see_the_child_can_read_goals(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    add_goal(db_session, child)
    therapist = make_therapist(db_session)
    link_therapist(db_session, therapist, child)

    for viewer in (parent, therapist, child):
        response = db_client.get(goals_url(child), headers=auth_headers(viewer))
        assert response.status_code == 200
        assert [g["title"] for g in response.json()] == ["Play 5 days"]

    stranger = make_user(db_session)
    assert db_client.get(goals_url(child), headers=auth_headers(stranger)).status_code == 404


def test_goals_can_be_filtered_by_status(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    add_goal(db_session, child, title="Done", status=GoalStatus.ACHIEVED)
    add_goal(db_session, child, title="Ongoing")

    response = db_client.get(f"{goals_url(child)}?status=achieved", headers=auth_headers(parent))

    assert [g["title"] for g in response.json()] == ["Done"]


def test_parent_updates_and_deletes_a_goal(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    goal = add_goal(db_session, child)
    url = f"{goals_url(child)}/{goal.id}"

    updated = db_client.patch(url, json={"status": "achieved"}, headers=auth_headers(parent))
    assert updated.status_code == 200
    assert updated.json()["status"] == "achieved"
    assert updated.json()["title"] == "Play 5 days"

    assert db_client.delete(url, headers=auth_headers(parent)).status_code == 204
    assert db_client.get(goals_url(child), headers=auth_headers(parent)).json() == []


def test_only_the_parent_can_change_goals(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    goal = add_goal(db_session, child)
    therapist = make_therapist(db_session)
    link_therapist(db_session, therapist, child)

    for account in (therapist, child):
        headers = auth_headers(account)
        assert (
            db_client.post(
                goals_url(child), json={"title": "x", "target_value": 1}, headers=headers
            ).status_code
            == 403
        )
        assert (
            db_client.patch(
                f"{goals_url(child)}/{goal.id}", json={"title": "x"}, headers=headers
            ).status_code
            == 403
        )


def test_a_goal_is_only_reachable_through_its_own_child(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    auth_headers: AuthHeaders,
) -> None:
    sibling = make_child(db_session, parent)
    goal = add_goal(db_session, sibling)

    response = db_client.patch(
        f"{goals_url(child)}/{goal.id}", json={"title": "x"}, headers=auth_headers(parent)
    )

    assert response.status_code == 404
