"""Stimulus audio and spoken answers, with fake STT/TTS (no models) and real ffmpeg."""

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Child, SessionRound, SpeechAttempt, User
from app.modules.games.catalogue import sync_games
from app.providers.speech.audio import read_wav
from tests.conftest import AuthHeaders
from tests.factories import make_child, make_user
from tests.fakes import FakeStt, FakeTts, tone_wav

pytestmark = pytest.mark.usefixtures("ffmpeg")  # skips locally, fails in CI

SESSIONS = "/api/sessions"


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


def start(client: TestClient, headers: dict[str, str], child: Child, game: str) -> dict[str, Any]:
    response = client.post(
        SESSIONS, json={"child_id": str(child.id), "game": game}, headers=headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def stored_round(db_session: Session, session_id: str, index: int) -> SessionRound:
    round_ = db_session.scalar(
        select(SessionRound).where(
            SessionRound.session_id == session_id, SessionRound.round_index == index
        )
    )
    assert round_ is not None
    return round_


def upload(
    client: TestClient,
    headers: dict[str, str],
    session_id: str,
    index: int = 0,
    audio: bytes | None = None,
    content_type: str = "audio/wav",
) -> Any:
    return client.post(
        f"{SESSIONS}/{session_id}/rounds/{index}/speech?response_time_ms=2500",
        content=tone_wav(seconds=0.8) if audio is None else audio,
        headers=headers | {"Content-Type": content_type},
    )


# ---------------------------------------------------------------- stimulus audio


def test_speech_stimulus_is_rendered_by_the_server(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    fake_tts: FakeTts,
) -> None:
    session = start(db_client, headers, child, "similar-sounds")
    url = session["rounds"][0]["prompt"]["stimulus"]["audio_url"]

    response = db_client.get(url, headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert read_wav(response.content).duration_ms > 0
    word = stored_round(db_session, session["id"], 0).stimulus["text"]
    assert fake_tts.calls == [word]

    db_client.get(url, headers=headers)
    assert fake_tts.calls == [word]  # served from the TTS cache the second time


def test_word_sequences_are_spoken_with_gaps(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    fake_tts: FakeTts,
) -> None:
    session = start(db_client, headers, child, "word-sequence")

    audio = db_client.get(
        session["rounds"][0]["prompt"]["stimulus"]["audio_url"], headers=headers
    ).content

    words = stored_round(db_session, session["id"], 0).stimulus["texts"]
    assert fake_tts.calls == words
    gaps_ms = 700 * (len(words) - 1)
    assert read_wav(audio).duration_ms > gaps_ms


def test_noise_is_mixed_into_the_stimulus(
    db_client: TestClient, child: Child, headers: dict[str, str]
) -> None:
    quiet = start(db_client, headers, child, "similar-sounds")
    noisy = start(db_client, headers, child, "listening-in-noise")

    def duration(session: dict[str, Any]) -> int:
        url = session["rounds"][0]["prompt"]["stimulus"]["audio_url"]
        return read_wav(db_client.get(url, headers=headers).content).duration_ms

    # Noise starts 400 ms before and ends 400 ms after the word.
    assert duration(noisy) >= 800
    assert duration(quiet) < duration(noisy) + 2000


def test_sound_stimuli_need_installed_sound_files(
    db_client: TestClient,
    db_session: Session,
    app: FastAPI,
    child: Child,
    headers: dict[str, str],
    tmp_path: Path,
    test_settings: Settings,
) -> None:
    session = start(db_client, headers, child, "sound-detective")
    url = session["rounds"][0]["prompt"]["stimulus"]["audio_url"]

    missing = db_client.get(url, headers=headers)
    assert missing.status_code == 503
    assert missing.json()["error"]["code"] == "sound_unavailable"

    sound_id = stored_round(db_session, session["id"], 0).stimulus["sound_id"]
    (tmp_path / f"{sound_id}.wav").write_bytes(tone_wav(seconds=1.0))
    app.state.settings = test_settings.model_copy(update={"SOUNDS_DIR": tmp_path})
    installed = db_client.get(url, headers=headers)
    assert installed.status_code == 200
    assert read_wav(installed.content).duration_ms == 1000


def test_other_families_cannot_fetch_the_audio(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    auth_headers: AuthHeaders,
) -> None:
    session = start(db_client, headers, child, "similar-sounds")
    url = session["rounds"][0]["prompt"]["stimulus"]["audio_url"]

    assert db_client.get(url).status_code == 401
    assert db_client.get(url, headers=auth_headers(make_user(db_session))).status_code == 404


# ---------------------------------------------------------------- spoken answers


def test_a_spoken_answer_is_transcribed_and_scored(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    fake_stt: FakeStt,
) -> None:
    session = start(db_client, headers, child, "speech-practice")
    target = stored_round(db_session, session["id"], 0).expected_answer["text"]
    fake_stt.transcript = target

    response = upload(db_client, headers, session["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_correct"] is True
    assert body["feedback"]["heard"] == target
    attempt = db_session.scalar(select(SpeechAttempt))
    assert attempt is not None
    assert attempt.provider == "fake-stt"
    assert attempt.audio_duration_ms == 800
    assert attempt.word_scores[0]["score"] == 100.0
    round_ = stored_round(db_session, session["id"], 0)
    db_session.refresh(round_)
    assert round_.response_time_ms == 2500


def test_a_mispronounced_answer_reports_the_sounds_to_practise(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    fake_stt: FakeStt,
) -> None:
    session = start(db_client, headers, child, "speech-practice")
    stored = stored_round(db_session, session["id"], 0)
    stored.expected_answer = {"text": "three"}
    db_session.commit()  # the speech flow ends its read transaction before transcribing
    fake_stt.transcript = "tree"

    body = upload(db_client, headers, session["id"]).json()

    assert body["is_correct"] is False
    assert body["feedback"]["practise_sounds"] == ["TH"]


def test_only_speech_games_take_recordings(
    db_client: TestClient, child: Child, headers: dict[str, str], fake_stt: FakeStt
) -> None:
    session = start(db_client, headers, child, "similar-sounds")

    response = upload(db_client, headers, session["id"])

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "not_a_speech_game"
    assert fake_stt.calls == 0


def test_nothing_is_transcribed_for_an_answered_round_or_a_stranger(
    db_client: TestClient,
    db_session: Session,
    child: Child,
    headers: dict[str, str],
    fake_stt: FakeStt,
    auth_headers: AuthHeaders,
) -> None:
    session = start(db_client, headers, child, "speech-practice")
    assert upload(db_client, headers, session["id"]).status_code == 200
    calls = fake_stt.calls

    again = upload(db_client, headers, session["id"])
    stranger = upload(db_client, auth_headers(make_user(db_session)), session["id"], index=1)

    assert again.status_code == 409
    assert stranger.status_code == 404
    assert fake_stt.calls == calls  # the expensive step never ran


@pytest.mark.parametrize(
    ("audio", "content_type", "status", "code"),
    [
        (b"not audio", "audio/webm", 422, "invalid_audio"),
        (None, "application/json", 415, "unsupported_audio"),
        (None, "text/plain", 415, "unsupported_audio"),
    ],
)
def test_bad_uploads_are_rejected(
    db_client: TestClient,
    child: Child,
    headers: dict[str, str],
    audio: bytes | None,
    content_type: str,
    status: int,
    code: str,
) -> None:
    session = start(db_client, headers, child, "speech-practice")

    response = upload(db_client, headers, session["id"], audio=audio, content_type=content_type)

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_oversized_uploads_are_refused_before_processing(
    db_client: TestClient,
    child: Child,
    headers: dict[str, str],
    fake_stt: FakeStt,
    test_settings: Settings,
) -> None:
    session = start(db_client, headers, child, "speech-practice")
    too_big = b"\0" * (test_settings.SPEECH_MAX_UPLOAD_BYTES + 1)

    response = upload(db_client, headers, session["id"], audio=too_big)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "audio_too_large"
    assert fake_stt.calls == 0


def test_speech_status_reports_providers(db_client: TestClient, headers: dict[str, str]) -> None:
    response = db_client.get("/api/speech/status", headers=headers)

    assert response.json() == {
        "stt": {"provider": "fake-stt", "available": True},
        "tts": {"voice": "fake:tone", "available": True},
    }
    assert db_client.get("/api/speech/status").status_code == 401
