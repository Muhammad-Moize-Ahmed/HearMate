import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app import cli
from app.auth.passwords import verify_secret
from app.db.models import User, UserRole
from tests.factories import make_user


@pytest.fixture
def cli_db(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Point the CLI at the test transaction instead of the real database."""
    factory = sessionmaker(bind=db_session.connection(), join_transaction_mode="create_savepoint")
    monkeypatch.setattr(cli, "get_sessionmaker", lambda: factory)
    yield db_session


def answer_prompts(monkeypatch: pytest.MonkeyPatch, *answers: str) -> None:
    replies = iter(answers)
    monkeypatch.setattr("getpass.getpass", lambda _prompt="": next(replies))


def test_create_admin(cli_db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    answer_prompts(monkeypatch, "a-strong-admin-pass", "a-strong-admin-pass")

    assert cli.main(["create-admin", "--email", "Admin@Example.com"]) == 0

    admin = cli_db.scalar(select(User).where(User.email == "admin@example.com"))
    assert admin is not None
    assert admin.role is UserRole.ADMIN
    assert admin.email_verified_at is not None
    assert verify_secret("a-strong-admin-pass", admin.password_hash)[0]


@pytest.mark.parametrize(
    "answers", [("short", "short"), ("a-strong-admin-pass", "a-different-password")]
)
def test_create_admin_rejects_bad_passwords(
    cli_db: Session, monkeypatch: pytest.MonkeyPatch, answers: tuple[str, str]
) -> None:
    answer_prompts(monkeypatch, *answers)

    assert cli.main(["create-admin", "--email", "admin@example.com"]) == 1
    assert cli_db.scalar(select(User).where(User.email == "admin@example.com")) is None


def test_create_admin_refuses_existing_emails(
    cli_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_user(cli_db, email="taken@example.com")
    answer_prompts(monkeypatch, "a-strong-admin-pass", "a-strong-admin-pass")

    assert cli.main(["create-admin", "--email", "taken@example.com"]) == 1


def test_export_openapi_writes_the_api_schema(tmp_path: Path) -> None:
    output = tmp_path / "openapi.json"

    assert cli.main(["export-openapi", "--output", str(output)]) == 0

    document = json.loads(output.read_text())
    assert "/api/auth/login" in document["paths"]
    assert "/api/children/{child_id}/learning-plans" in document["paths"]
