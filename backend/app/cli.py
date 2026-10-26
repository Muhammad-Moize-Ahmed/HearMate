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
from .db.models import User, UserRole
from .db.session import get_sessionmaker
from .modules.auth.schemas import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from .modules.games.catalogue import sync_games


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

    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email, args.first_name, args.last_name)
    if args.command == "sync-games":
        return sync_games_command()
    return 2


if __name__ == "__main__":
    sys.exit(main())
