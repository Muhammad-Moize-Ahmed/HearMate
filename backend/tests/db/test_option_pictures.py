"""Pictures reach the stored rounds and the API all-or-none, for every game (with a test bank)."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import CurrentPrincipal, DbSession
from app.core.deps import AppSettings
from app.db.models import Child, SessionRound, User
from app.modules.games.catalogue import sync_games
from app.modules.games.content import ContentBank, load_bank
from app.modules.games.router import get_service
from app.modules.games.service import GameSessionService
from tests.conftest import AuthHeaders
from tests.factories import make_child, make_user
from tests.gameplay import start

# Every word the word games can use, each with its own (made-up) picture.
WORDS = sorted(
    {w.text for w in load_bank().words}
    | {w for s in load_bank().minimal_pair_sets for w in s.words}
)
EVERY_WORD = {word: chr(0x1F400 + i) for i, word in enumerate(WORDS)}  # distinct animal emoji


@pytest.fixture(autouse=True)
def games(db_session: Session) -> None:
    sync_games(db_session)


@pytest.fixture
def child(db_session: Session) -> Child:
    return make_child(db_session, make_user(db_session))


@pytest.fixture
def headers(child: Child, db_session: Session, auth_headers: AuthHeaders) -> dict[str, str]:
    parent = db_session.get(User, child.parent_id)
    assert parent is not None
    return auth_headers(parent)


@pytest.fixture
def use_bank(app: FastAPI) -> Iterator[Any]:
    """Make the game engine build rounds from a bank with these word pictures."""

    def install(pictures: dict[str, str]) -> None:
        bank: ContentBank = load_bank().model_copy(update={"pictures": pictures})

        def service(
            db: DbSession, principal: CurrentPrincipal, settings: AppSettings
        ) -> GameSessionService:
            return GameSessionService(db, principal, settings=settings, bank=bank)

        app.dependency_overrides[get_service] = service

    yield install
    app.dependency_overrides.pop(get_service, None)


def stored(db_session: Session, session_id: str) -> list[SessionRound]:
    return list(
        db_session.scalars(select(SessionRound).where(SessionRound.session_id == session_id))
    )


def pictures(options: list[dict[str, Any]]) -> list[str | None]:
    return [o.get("emoji") for o in options]


@pytest.mark.parametrize("game", ["similar-sounds", "listening-in-noise", "word-sequence"])
def test_full_coverage_shows_every_picture(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    use_bank: Any,
    game: str,
) -> None:
    use_bank(EVERY_WORD)

    session = start(db_client, headers, child, game)

    for shown in session["rounds"]:
        options = shown["prompt"]["options"]
        assert pictures(options) == [EVERY_WORD[o["id"]] for o in options]
    for round_ in stored(db_session, session["id"]):  # stored with the round, as shown
        assert all(o.get("emoji") for o in round_.prompt["options"])


@pytest.mark.parametrize("game", ["similar-sounds", "listening-in-noise", "word-sequence"])
def test_partial_coverage_shows_no_pictures(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    use_bank: Any,
    game: str,
) -> None:
    use_bank({"cat": "🐱"})  # every round has at least one option without a picture

    session = start(db_client, headers, child, game)

    for shown in session["rounds"]:
        assert all("emoji" not in o for o in shown["prompt"]["options"])  # left out, not null
    for round_ in stored(db_session, session["id"]):
        assert all("emoji" not in o for o in round_.prompt["options"])


def test_each_round_is_judged_on_its_own_options(
    db_client: TestClient, child: Child, headers: dict[str, str], use_bank: Any
) -> None:
    # Level 1 plays each of the 8 easy pair sets once; only cat/hat lacks a picture.
    use_bank({w: e for w, e in EVERY_WORD.items() if w != "hat"})

    session = start(db_client, headers, child, "similar-sounds")

    shown = {
        tuple(sorted(o["id"] for o in r["prompt"]["options"])): pictures(r["prompt"]["options"])
        for r in session["rounds"]
    }
    assert len(shown) == 8
    assert shown.pop(("cat", "hat")) == [None, None]
    assert all(None not in p for p in shown.values())


@pytest.mark.parametrize("game", ["similar-sounds", "word-sequence"])
def test_two_options_with_the_same_picture_show_none(
    db_client: TestClient, child: Child, headers: dict[str, str], use_bank: Any, game: str
) -> None:
    use_bank(dict.fromkeys(EVERY_WORD, "🐱"))

    session = start(db_client, headers, child, game)

    assert all(
        pictures(r["prompt"]["options"]) == [None] * len(r["prompt"]["options"])
        for r in session["rounds"]
    )


def test_word_sequence_follows_the_same_rule_with_the_real_bank(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    bank = load_bank()
    seen = []
    for _ in range(4):
        session = start(db_client, headers, child, "word-sequence")
        for shown in session["rounds"]:
            options = shown["prompt"]["options"]
            expected = (
                [bank.pictures[o["id"]] for o in options]
                if all(o["id"] in bank.pictures for o in options)
                else [None] * len(options)
            )
            assert pictures(options) == expected
            seen.append(expected[0] is not None)
    assert any(seen)  # level 1 uses easy words, nearly all of which have a picture


def test_sound_detective_shows_every_sounds_picture(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    sounds = {s.id: s.emoji for s in load_bank().sounds}

    session = start(db_client, headers, child, "sound-detective")

    for shown in session["rounds"]:
        options = shown["prompt"]["options"]
        assert pictures(options) == [sounds[o["id"]] for o in options]
