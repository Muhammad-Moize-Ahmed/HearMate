from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Child,
    DailyActivity,
    Goal,
    GoalStatus,
    SkillCategory,
    User,
    UserRole,
)
from app.modules.games.catalogue import sync_games
from app.modules.progress.achievements import CATALOGUE
from tests.conftest import AuthHeaders
from tests.factories import link_therapist, make_child, make_therapist, make_user
from tests.gameplay import SESSIONS, play_game, set_level, start

KARACHI = ZoneInfo("Asia/Karachi")


@pytest.fixture(autouse=True)
def games(db_session: Session) -> None:
    sync_games(db_session)


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent, display_name="Ali")


@pytest.fixture
def headers(parent: User, auth_headers: AuthHeaders) -> dict[str, str]:
    return auth_headers(parent)


def today_in(zone: ZoneInfo) -> date:
    return datetime.now(UTC).astimezone(zone).date()


def activity(db_session: Session, child: Child) -> list[DailyActivity]:
    db_session.expire_all()
    return list(db_session.scalars(select(DailyActivity).where(DailyActivity.child_id == child.id)))


# ---------------------------------------------------------------- recording on completion


def test_completing_a_session_records_the_childs_local_day(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    first = play_game(db_client, db_session, headers, child, "sound-detective")
    play_game(db_client, db_session, headers, child, "word-sequence", correct=3)

    [day] = activity(db_session, child)
    assert day.activity_date == today_in(KARACHI)
    assert day.sessions_completed == 2
    assert day.points_earned == first["result"]["points"] + 30
    assert first["result"]["streak_days"] == 1


@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])  # UTC+14, UTC-11
def test_the_childs_own_time_zone_is_used(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    zone: str,
) -> None:
    db_client.patch(f"/api/children/{child.id}", json={"timezone": zone}, headers=headers)

    play_game(db_client, db_session, headers, child, "sound-detective")

    assert activity(db_session, child)[0].activity_date == today_in(ZoneInfo(zone))


def test_invalid_time_zones_are_rejected(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    response = db_client.patch(
        f"/api/children/{child.id}", json={"timezone": "Mars/Olympus_Mons"}, headers=headers
    )

    assert response.status_code == 422


def test_abandoned_sessions_are_not_recorded(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    db_client.post(f"{SESSIONS}/{session['id']}/abandon", headers=headers)

    assert activity(db_session, child) == []


def test_first_perfect_session_unlocks_achievements_once(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    first = play_game(db_client, db_session, headers, child, "sound-detective")
    second = play_game(db_client, db_session, headers, child, "sound-detective", correct=4)

    assert {a["code"] for a in first["result"]["new_achievements"]} == {
        "first_game",
        "perfect_game",
        "level_up",
    }
    assert second["result"]["new_achievements"] == []


def test_streaks_continue_from_previous_days(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    today = today_in(KARACHI)
    for days_back in (1, 2):
        db_session.add(
            DailyActivity(
                child_id=child.id,
                activity_date=today - timedelta(days=days_back),
                sessions_completed=1,
            )
        )
    db_session.flush()

    result = play_game(db_client, db_session, headers, child, "word-sequence", correct=1)["result"]

    assert result["streak_days"] == 3
    assert "streak_3" in {a["code"] for a in result["new_achievements"]}


def test_goals_track_sessions_in_their_skill(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play_game(db_client, db_session, headers, child, "sound-detective")  # before the goal: ignored
    goal = db_client.post(
        f"/api/children/{child.id}/goals",
        json={"title": "Two listening games", "category": "listening", "target_value": 2},
        headers=headers,
    ).json()

    play_game(db_client, db_session, headers, child, "word-sequence", correct=1)  # memory
    first = play_game(db_client, db_session, headers, child, "similar-sounds", correct=1)
    second = play_game(db_client, db_session, headers, child, "listening-in-noise", correct=1)

    assert first["result"]["goals_achieved"] == []
    assert second["result"]["goals_achieved"] == ["Two listening games"]
    stored = db_session.get(Goal, goal["id"], populate_existing=True)
    assert stored is not None
    assert (stored.current_value, stored.status) == (2, GoalStatus.ACHIEVED)


def test_goals_stop_counting_after_their_due_date(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    goal = Goal(
        child_id=child.id,
        title="Last week",
        target_value=5,
        due_date=today_in(KARACHI) - timedelta(days=1),
        created_at=datetime.now(UTC) - timedelta(days=10),
    )
    db_session.add(goal)
    db_session.flush()

    play_game(db_client, db_session, headers, child, "sound-detective")

    db_session.refresh(goal)
    assert goal.current_value == 0


# ---------------------------------------------------------------- summary & trend


def test_progress_summary(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    set_level(db_session, child, SkillCategory.LISTENING, 4)
    for correct in (2, 2, 8, 8):  # 25%, 25%, 100%, 100%
        play_game(db_client, db_session, headers, child, "sound-detective", correct=correct)
    play_game(db_client, db_session, headers, child, "word-sequence", correct=3)

    summary = db_client.get(f"/api/children/{child.id}/progress", headers=headers).json()

    assert summary["period"]["days"] == 30
    assert summary["period"]["timezone"] == "Asia/Karachi"
    assert summary["all_time"]["sessions"] == summary["in_period"]["sessions"] == 5
    assert summary["current_streak"] == 1
    skills = {s["category"]: s for s in summary["skills"]}
    assert skills["listening"]["sessions"] == 4
    assert skills["listening"]["average_accuracy"] == 62.5
    assert skills["listening"]["accuracy_change"] == 75.0
    assert skills["memory"]["sessions"] == 1
    assert skills["speech"]["sessions"] == 0
    assert skills["speech"]["average_accuracy"] is None
    assert summary["recent_level_changes"]
    assert summary["achievements_unlocked"] >= 1


def test_trend_has_one_entry_per_day(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play_game(db_client, db_session, headers, child, "sound-detective")

    trend = db_client.get(f"/api/children/{child.id}/progress/trend?days=7", headers=headers).json()

    assert len(trend) == 7
    assert trend[-1]["date"] == today_in(KARACHI).isoformat()
    assert (trend[-1]["sessions"], trend[-1]["average_accuracy"]) == (1, 100.0)
    assert all(day["sessions"] == 0 for day in trend[:-1])


def test_the_period_is_validated(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    for days in (3, 400):
        url = f"/api/children/{child.id}/progress?days={days}"
        assert db_client.get(url, headers=headers).status_code == 422


# ---------------------------------------------------------------- detailed report


def test_report_breaks_down_noise_speech_and_contrasts(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play_game(db_client, db_session, headers, child, "listening-in-noise", correct=6)
    play_game(db_client, db_session, headers, child, "similar-sounds", correct=0)
    play_game(db_client, db_session, headers, child, "speech-practice", correct=0)

    report = db_client.get(f"/api/children/{child.id}/report", headers=headers).json()

    assert [g["slug"] for g in report["games"]] == [
        "similar-sounds",
        "listening-in-noise",
        "speech-practice",
    ]
    noise = report["listening_in_noise"]
    assert [(b["band"], b["rounds"], b["accuracy"]) for b in noise] == [("quiet", 8, 75.0)]
    assert report["speech"]["attempts"] == 6
    assert report["speech"]["sounds_to_practise"]
    assert report["hardest_contrasts"][0]["accuracy"] == 0.0
    assert report["games"][0]["average_response_ms"] == 1500


def test_report_access(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    auth_headers: AuthHeaders,
) -> None:
    linked = make_therapist(db_session)
    link_therapist(db_session, linked, child)
    url = f"/api/children/{child.id}/report"

    assert db_client.get(url, headers=auth_headers(linked)).status_code == 200
    assert db_client.get(url, headers=auth_headers(child)).status_code == 403
    assert db_client.get(url, headers=auth_headers(make_therapist(db_session))).status_code == 404
    assert db_client.get(url, headers=auth_headers(make_user(db_session))).status_code == 404
    viewed = db_session.scalars(
        select(AuditLog.actor_user_id).where(AuditLog.action == "child_report_viewed")
    ).all()
    assert viewed == [linked.id]


# ---------------------------------------------------------------- achievements & bests


def test_achievements_list_the_whole_catalogue(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play_game(db_client, db_session, headers, child, "sound-detective")

    badges = db_client.get(f"/api/children/{child.id}/achievements", headers=headers).json()

    assert len(badges) == len(CATALOGUE)
    unlocked = {b["code"] for b in badges if b["unlocked_at"]}
    assert unlocked == {"first_game", "perfect_game", "level_up"}


def test_personal_bests_per_game(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play_game(db_client, db_session, headers, child, "sound-detective")  # 100%: up to level 2
    play_game(db_client, db_session, headers, child, "sound-detective", correct=4)  # 50%: back to 1
    play_game(db_client, db_session, headers, child, "word-sequence", correct=3)

    bests = db_client.get(f"/api/children/{child.id}/personal-bests", headers=headers).json()

    sound = bests[0]
    assert (sound["game"], sound["sessions"], sound["best_accuracy"]) == (
        "sound-detective",
        2,
        100.0,
    )
    assert sound["best_points"] == 90
    assert sound["highest_level"] == 2
    assert bests[1]["game"] == "word-sequence"


# ---------------------------------------------------------------- family comparison


def test_family_progress_compares_siblings_only(
    db_client: TestClient,
    db_session: Session,
    parent: User,
    child: Child,
    headers: dict[str, str],
    auth_headers: AuthHeaders,
) -> None:
    sibling = make_child(db_session, parent, display_name="Zara")
    other_family = make_child(db_session, make_user(db_session), display_name="Stranger")
    play_game(db_client, db_session, headers, child, "sound-detective")

    as_parent = db_client.get("/api/family/progress", headers=headers).json()
    as_child = db_client.get("/api/family/progress", headers=auth_headers(sibling)).json()

    assert [m["display_name"] for m in as_parent] == ["Ali", "Zara"]
    assert as_child == as_parent
    assert as_parent[0]["this_week"]["sessions"] == 1
    assert as_parent[0]["current_streak"] == 1
    assert as_parent[1]["this_week"]["sessions"] == 0
    assert str(other_family.id) not in {m["child_id"] for m in as_parent}


def test_family_progress_is_only_for_families(
    db_client: TestClient, db_session: Session, auth_headers: AuthHeaders
) -> None:
    for account in (make_therapist(db_session), make_user(db_session, role=UserRole.ADMIN)):
        assert (
            db_client.get("/api/family/progress", headers=auth_headers(account)).status_code == 403
        )


def test_progress_views_respect_child_access(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    stranger = auth_headers(make_user(db_session))

    for path in ("progress", "progress/trend", "achievements", "personal-bests"):
        response = db_client.get(f"/api/children/{child.id}/{path}", headers=stranger)
        assert response.status_code == 404, path
    assert (
        db_client.get(f"/api/children/{child.id}/progress", headers=auth_headers(child)).status_code
        == 200
    )
