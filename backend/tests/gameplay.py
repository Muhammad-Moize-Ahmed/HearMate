"""Helpers that play game sessions through the API like a child would."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Child, SessionRound, SkillCategory, SkillLevel

SESSIONS = "/api/sessions"


def start(
    client: TestClient, headers: dict[str, str], child: Child, game: str, **extra: Any
) -> dict[str, Any]:
    response = client.post(
        SESSIONS, json={"child_id": str(child.id), "game": game} | extra, headers=headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def answer_for(round_: SessionRound, *, correct: bool) -> dict[str, Any]:
    """What a child who gets it right (or wrong) would send for this round."""
    expected = round_.expected_answer
    if "choice" in expected:
        if correct:
            return {"choice": expected["choice"]}
        wrong = next(o["id"] for o in round_.prompt["options"] if o["id"] != expected["choice"])
        return {"choice": wrong}
    if "sequence" in expected:
        return {"sequence": expected["sequence"] if correct else expected["sequence"][::-1]}
    return {"transcript": expected["text"] if correct else "something else entirely"}


def play(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    session_id: str,
    *,
    correct: int | None = None,
    response_time_ms: int = 1500,
) -> dict[str, Any]:
    """Answer every round (the first `correct` right, the rest wrong), then complete."""
    rounds = db_session.scalars(
        select(SessionRound)
        .where(SessionRound.session_id == session_id)
        .order_by(SessionRound.round_index)
    ).all()
    for round_ in rounds:
        right = correct is None or round_.round_index < correct
        response = client.post(
            f"{SESSIONS}/{session_id}/rounds/{round_.round_index}/answer",
            json={
                "answer": answer_for(round_, correct=right),
                "response_time_ms": response_time_ms,
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
    done = client.post(f"{SESSIONS}/{session_id}/complete", headers=headers)
    assert done.status_code == 200, done.text
    body: dict[str, Any] = done.json()
    return body


def play_game(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    child: Child,
    game: str,
    *,
    correct: int | None = None,
) -> dict[str, Any]:
    """Start and finish one session; returns the completion response."""
    session_id = start(client, headers, child, game)["id"]
    return play(client, db_session, headers, session_id, correct=correct)


def set_level(db_session: Session, child: Child, category: SkillCategory, level: int) -> None:
    db_session.add(SkillLevel(child_id=child.id, category=category, level=level))
    db_session.flush()
