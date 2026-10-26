"""Operator commands, e.g.:

uv run python -m app.cli create-admin --email admin@example.com
uv run python -m app.cli sync-games
"""

import argparse
import getpass
import sys
from datetime import UTC, datetime

from sqlalchemy import select

from .auth.passwords import hash_secret
from .core.config import get_settings
from .db.models import User, UserRole
from .db.session import get_sessionmaker
from .modules.auth.schemas import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from .modules.games.catalogue import sync_games
from .modules.games.pronunciation import score_pronunciation
from .providers.speech import build_speech_services
from .providers.speech.audio import to_wav
from .providers.speech.piper_tts import PiperTts
from .providers.speech.whisper import WhisperStt


def create_admin(email: str, first_name: str, last_name: str) -> int:
    email = email.strip().lower()
    password = getpass.getpass("Password: ")
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        print(f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters.")
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.")
        return 1

    with get_sessionmaker()() as db:
        if db.scalar(select(User).where(User.email == email)) is not None:
            print(f"A user with email {email} already exists.")
            return 1
        db.add(
            User(
                email=email,
                password_hash=hash_secret(password),
                role=UserRole.ADMIN,
                first_name=first_name,
                last_name=last_name,
                email_verified_at=datetime.now(UTC),
            )
        )
        db.commit()
    print(f"Admin {email} created.")
    return 0


def sync_games_command() -> int:
    with get_sessionmaker()() as db:
        report = sync_games(db)
    for label, slugs in (
        ("created", report.created),
        ("updated", report.updated),
        ("deactivated", report.deactivated),
    ):
        if slugs:
            print(f"{label}: {', '.join(slugs)}")
    print("Games are in sync with the registry.")
    return 0


def speech_setup_command() -> int:
    """Download the configured speech models (outside the repo) and run a round-trip check."""
    settings = get_settings()
    speech = build_speech_services(settings)

    if isinstance(speech.tts, PiperTts):
        if speech.tts.available():
            print(f"Piper voice already present: {speech.tts.model_path}")
        else:
            print(f"Downloading Piper voice {settings.PIPER_VOICE} to {speech.tts.voice_dir} ...")
            print(f"Saved {speech.tts.download()}")
    if isinstance(speech.stt, WhisperStt):
        print(f"Loading Whisper model {settings.WHISPER_MODEL} (downloads on first run) ...")
        speech.stt.load()

    if speech.tts is None or speech.stt is None:
        print("TTS or STT is turned off; skipping the round-trip check.")
        return 0
    sentence = "The cat is sleeping."
    transcription, _clip = speech.transcribe(to_wav(speech.speak(sentence)))
    result = score_pronunciation(sentence, transcription.text)
    print(f"Round trip: said {sentence!r}, heard {transcription.text!r}, score {result.score}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser(
        "create-admin", help="Create an admin account (prompts for password)"
    )
    admin.add_argument("--email", required=True)
    admin.add_argument("--first-name", default="Admin")
    admin.add_argument("--last-name", default="User")

    commands.add_parser("sync-games", help="Create/update the games table from the code registry")
    commands.add_parser(
        "speech-setup", help="Download speech models (outside the repo) and self-test them"
    )

    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email, args.first_name, args.last_name)
    if args.command == "sync-games":
        return sync_games_command()
    if args.command == "speech-setup":
        return speech_setup_command()
    return 2


if __name__ == "__main__":
    sys.exit(main())
