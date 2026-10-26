from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app import cli
from app.db.models import (
    Child,
    Game,
    GameSession,
    LevelHistory,
    SessionRound,
    SessionStatus,
    SkillCategory,
    SkillLevel,
    SpeechAttempt,
    User,
    UserRole,
)
from app.modules.games.catalogue import sync_games
from tests.conftest import AuthHeaders
from tests.factories import link_therapist, make_child, make_therapist, make_user
from tests.gameplay import SESSIONS, answer_for, play, set_level, start


@pytest.fixture(autouse=True)
def games(db_session: Session) -> None:
    sync_games(db_session)


@pytest.fixture
def parent(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def child(db_session: Session, parent: User) -> Child:
    return make_child(db_session, parent)


@pytest.fixture
def headers(parent: User, auth_headers: AuthHeaders) -> dict[str, str]:
    return auth_headers(parent)


# ---------------------------------------------------------------- catalogue


def test_catalogue_lists_the_five_games_in_order(
    db_client: TestClient, db_session: Session, headers: dict[str, str]
) -> None:
    response = db_client.get("/api/games", headers=headers)

    assert response.status_code == 200
    assert [g["slug"] for g in response.json()] == [
        "sound-detective",
        "similar-sounds",
        "word-sequence",
        "listening-in-noise",
        "speech-practice",
    ]

    game = db_session.scalar(select(Game).where(Game.slug == "word-sequence"))
    assert game is not None
    game.is_active = False
    db_session.flush()
    slugs = [g["slug"] for g in db_client.get("/api/games", headers=headers).json()]
    assert "word-sequence" not in slugs


def test_sync_is_idempotent_and_keeps_admin_choices(db_session: Session) -> None:
    game = db_session.scalar(select(Game).where(Game.slug == "word-sequence"))
    assert game is not None
    game.is_active = False
    db_session.add(
        Game(slug="retired-game", title="Old", category=SkillCategory.MEMORY, description="x")
    )
    db_session.flush()

    report = sync_games(db_session)

    assert report.created == [] and report.updated == []
    assert report.deactivated == ["retired-game"]
    assert game.is_active is False


def test_sync_games_cli(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = sessionmaker(bind=db_session.connection(), join_transaction_mode="create_savepoint")
    monkeypatch.setattr(cli, "get_sessionmaker", lambda: factory)

    assert cli.main(["sync-games"]) == 0


# ---------------------------------------------------------------- starting


def test_starting_a_session_builds_rounds_without_revealing_answers(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    assert session["status"] == "in_progress"
    assert (session["level"], session["difficulty"]) == (1, "easy")
    assert len(session["rounds"]) == 8
    for round_ in session["rounds"]:
        assert round_["correct_answer"] is None
        assert round_["answered"] is False
        assert len(round_["prompt"]["options"]) == 2
    skill = db_session.scalar(select(SkillLevel).where(SkillLevel.child_id == child.id))
    assert skill is not None and skill.category is SkillCategory.LISTENING


def test_listening_in_noise_always_has_noise(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "listening-in-noise")

    assert session["with_noise"] is True
    prompt = session["rounds"][0]["prompt"]
    assert prompt["noise"] == {"kind": "white", "snr_db": 20.0}  # mixed in by the server
    assert prompt["stimulus"] == {
        "type": "speech",
        "audio_url": f"/api/sessions/{session['id']}/rounds/0/stimulus",
    }


def test_games_without_noise_refuse_it(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    response = db_client.post(
        SESSIONS,
        json={"child_id": str(child.id), "game": "speech-practice", "with_noise": True},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "noise_not_supported"


def test_unknown_games_are_404(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    response = db_client.post(
        SESSIONS, json={"child_id": str(child.id), "game": "no-such-game"}, headers=headers
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "game_not_found"


def test_who_can_play_for_a_child(
    db_client: TestClient, db_session: Session, child: Child, auth_headers: AuthHeaders
) -> None:
    linked = make_therapist(db_session)
    link_therapist(db_session, linked, child)
    body = {"child_id": str(child.id), "game": "sound-detective"}

    for account, status in (
        (child, 201),
        (linked, 201),
        (make_therapist(db_session), 404),
        (make_user(db_session), 404),
        (make_user(db_session, role=UserRole.ADMIN), 404),
    ):
        assert (
            db_client.post(SESSIONS, json=body, headers=auth_headers(account)).status_code == status
        )


def test_starting_again_abandons_the_unfinished_session(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    first = start(db_client, headers, child, "sound-detective")
    start(db_client, headers, child, "word-sequence")

    old = db_session.get(GameSession, first["id"], populate_existing=True)
    assert old is not None and old.status is SessionStatus.ABANDONED


# ---------------------------------------------------------------- answering


def test_answers_are_checked_by_the_server(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    rounds = db_session.scalars(
        select(SessionRound)
        .where(SessionRound.session_id == session["id"])
        .order_by(SessionRound.round_index)
    ).all()
    url = f"{SESSIONS}/{session['id']}/rounds"

    right = db_client.post(
        f"{url}/0/answer", json={"answer": answer_for(rounds[0], correct=True)}, headers=headers
    )
    wrong = db_client.post(
        f"{url}/1/answer", json={"answer": answer_for(rounds[1], correct=False)}, headers=headers
    )

    assert right.json()["is_correct"] is True
    assert right.json()["rounds_remaining"] == 7
    assert wrong.json()["is_correct"] is False
    assert wrong.json()["correct_answer"] == rounds[1].expected_answer
    shown = db_client.get(f"{SESSIONS}/{session['id']}", headers=headers).json()["rounds"]
    assert shown[0]["correct_answer"] is not None
    assert shown[2]["correct_answer"] is None


def test_each_round_is_answered_once(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    url = f"{SESSIONS}/{session['id']}/rounds/0/answer"
    db_client.post(url, json={"answer": {"choice": "dog"}}, headers=headers)

    again = db_client.post(url, json={"answer": {"choice": "cat"}}, headers=headers)

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_answered"


@pytest.mark.parametrize(
    ("answer", "status"),
    [({"sequence": ["dog"]}, 422), ({"choice": "x" * 65}, 422), ({}, 422)],
)
def test_answers_must_fit_the_game(
    db_client: TestClient,
    child: Child,
    headers: dict[str, str],
    answer: dict[str, Any],
    status: int,
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    response = db_client.post(
        f"{SESSIONS}/{session['id']}/rounds/0/answer", json={"answer": answer}, headers=headers
    )

    assert response.status_code == status
    assert response.json()["error"]["details"][0]["loc"][:2] == ["body", "answer"]


def test_clients_cannot_send_a_score(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    response = db_client.post(
        f"{SESSIONS}/{session['id']}/rounds/0/answer",
        json={"answer": {"choice": "dog"}, "is_correct": True, "points": 1000},
        headers=headers,
    )

    assert response.status_code == 422


def test_missing_rounds_are_404(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    response = db_client.post(
        f"{SESSIONS}/{session['id']}/rounds/50/answer",
        json={"answer": {"choice": "dog"}},
        headers=headers,
    )

    assert response.status_code == 404


def test_other_families_cannot_see_or_answer_a_session(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    auth_headers: AuthHeaders,
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    stranger = auth_headers(make_user(db_session))

    assert db_client.get(f"{SESSIONS}/{session['id']}", headers=stranger).status_code == 404
    response = db_client.post(
        f"{SESSIONS}/{session['id']}/rounds/0/answer",
        json={"answer": {"choice": "dog"}},
        headers=stranger,
    )
    assert response.status_code == 404


# ---------------------------------------------------------------- completing and levels


def test_a_perfect_session_scores_and_levels_up(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    done = play(db_client, db_session, headers, session["id"])

    assert done["status"] == "completed"
    result = done["result"]
    assert (result["correct_rounds"], result["total_rounds"], result["accuracy"]) == (8, 8, 100.0)
    assert result["points"] == 90  # 8 x 10, plus a 10-point perfect bonus, easy multiplier x1
    assert (result["level_before"], result["level_after"]) == (1, 2)
    assert result["level_reason"].startswith("Level up")
    assert all(r["correct_answer"] is not None for r in done["rounds"])
    history = db_session.scalar(select(LevelHistory).where(LevelHistory.child_id == child.id))
    assert history is not None and (history.old_level, history.new_level) == (1, 2)


def test_a_poor_session_moves_the_level_down(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    set_level(db_session, child, SkillCategory.LISTENING, 5)
    session = start(db_client, headers, child, "similar-sounds")
    assert session["difficulty"] == "medium"

    done = play(db_client, db_session, headers, session["id"], correct=2)

    assert done["result"]["accuracy"] == 25.0
    assert done["result"]["level_after"] == 4


def test_slow_but_accurate_children_stay_to_build_speed(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    done = play(db_client, db_session, headers, session["id"], response_time_ms=20_000)

    assert done["result"]["level_after"] == 1
    assert done["result"]["level_reason"].startswith("Accurate but slow")


def test_a_weaker_recent_session_holds_back_a_level_up(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    set_level(db_session, child, SkillCategory.LISTENING, 3)

    results = [
        play(
            db_client,
            db_session,
            headers,
            start(db_client, headers, child, "sound-detective")["id"],
            correct=correct,
        )["result"]
        for correct in (6, 4, 8)  # 75%, 50%, then a perfect 100%
    ]

    assert [r["level_after"] for r in results] == [3, 3, 3]
    assert results[2]["level_reason"] == (
        "Staying at this level (100% this session, 75% over the last 3)."
    )


def test_sessions_from_an_earlier_level_are_ignored(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    set_level(db_session, child, SkillCategory.MEMORY, 3)
    first = play(
        db_client,
        db_session,
        headers,
        start(db_client, headers, child, "word-sequence")["id"],
        correct=2,
    )
    assert first["result"]["level_after"] == 2  # 33%: easier level

    second = play(
        db_client, db_session, headers, start(db_client, headers, child, "word-sequence")["id"]
    )

    # Only the level-2 session counts, so one perfect session is enough to go back up.
    assert second["result"]["level_after"] == 3
    assert second["result"]["level_reason"].endswith("100% over the last 1).")


def test_categories_level_independently(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play(db_client, db_session, headers, start(db_client, headers, child, "sound-detective")["id"])

    levels = db_client.get(f"/api/children/{child.id}/levels", headers=headers).json()

    assert {lvl["category"]: lvl["level"] for lvl in levels} == {
        "listening": 2,
        "speech": 1,
        "memory": 1,
    }


def test_completing_needs_every_round_answered(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    response = db_client.post(f"{SESSIONS}/{session['id']}/complete", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["details"]["unanswered"] == list(range(8))


def test_finished_sessions_are_read_only(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    play(db_client, db_session, headers, session["id"])

    for url in (f"{SESSIONS}/{session['id']}/complete", f"{SESSIONS}/{session['id']}/abandon"):
        response = db_client.post(url, headers=headers)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "session_not_active"


def test_abandoned_sessions_reveal_answers_and_do_not_change_levels(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")

    abandoned = db_client.post(f"{SESSIONS}/{session['id']}/abandon", headers=headers).json()

    assert abandoned["status"] == "abandoned"
    assert abandoned["result"] is None
    assert all(r["correct_answer"] is not None for r in abandoned["rounds"])
    skill = db_session.scalar(select(SkillLevel).where(SkillLevel.child_id == child.id))
    assert skill is not None and skill.level == 1


def test_long_idle_sessions_cap_their_duration(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    row = db_session.get(GameSession, session["id"])
    assert row is not None
    row.started_at = datetime.now(UTC) - timedelta(days=1)
    db_session.flush()

    done = play(db_client, db_session, headers, session["id"])

    assert done["result"]["duration_seconds"] == 2 * 60 * 60


def test_speech_practice_accepts_a_browser_transcript_as_fallback(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    session = start(db_client, headers, child, "speech-practice")
    text = session["rounds"][0]["prompt"]["display_text"]

    response = db_client.post(
        f"{SESSIONS}/{session['id']}/rounds/0/answer",
        json={"answer": {"transcript": f"  {text.upper()}! "}},
        headers=headers,
    )

    assert response.json()["is_correct"] is True
    assert response.json()["feedback"]["score"] == 100.0
    attempt = db_session.scalar(select(SpeechAttempt))
    assert attempt is not None
    assert (attempt.provider, attempt.accuracy) == ("browser", 100.0)
    assert attempt.word_scores[0]["expected"] == text


def test_session_history_is_newest_first_and_filterable(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str]
) -> None:
    play(db_client, db_session, headers, start(db_client, headers, child, "sound-detective")["id"])
    start(db_client, headers, child, "word-sequence")
    url = f"/api/children/{child.id}/sessions"

    everything = db_client.get(url, headers=headers).json()
    only_sounds = db_client.get(f"{url}?game=sound-detective", headers=headers).json()

    assert [s["game"]["slug"] for s in everything] == ["word-sequence", "sound-detective"]
    assert [s["status"] for s in only_sounds] == ["completed"]
    assert only_sounds[0]["points"] == 90


@pytest.mark.parametrize("game", ["sound-detective", "similar-sounds", "word-sequence"])
def test_prompts_never_reveal_the_stimulus(
    db_client: TestClient, db_session: Session, child: Child, headers: dict[str, str], game: str
) -> None:
    session = start(db_client, headers, child, game)

    rounds = db_session.scalars(
        select(SessionRound).where(SessionRound.session_id == session["id"])
    ).all()
    for shown, stored in zip(
        session["rounds"], sorted(rounds, key=lambda r: r.round_index), strict=True
    ):
        assert set(shown["prompt"]["stimulus"]) == {"type", "audio_url"}
        assert stored.stimulus["type"] == shown["prompt"]["stimulus"]["type"]
        assert len(stored.stimulus) > 1  # the private part (word, words or sound) is stored
