from collections.abc import Callable, Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.orm import Session

from app.auth.principal import Principal, PrincipalKind, kind_for_role
from app.auth.tokens import create_access_token
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.db.models import Child, User
from app.db.session import get_db
from app.main import create_app
from app.providers.speech import SpeechServices
from app.providers.speech.cache import TtsCache
from tests.fakes import FakeStt, FakeTts, RecordingEmailSender


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    # Everything under tests/db/ needs PostgreSQL (docker compose up -d db).
    tests_dir = Path(__file__).parent
    for item in items:
        if Path(item.path).relative_to(tests_dir).parts[0] == "db":
            item.add_marker(pytest.mark.db)


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    return Settings(ENVIRONMENT="test", LOG_FORMAT="console")


@pytest.fixture(scope="session")
def test_database_url(test_settings: Settings) -> URL:
    """A dedicated `<db>_test` database on the same server, so dev data is never touched."""
    base_url = test_settings.database_url
    test_url = base_url.set(database=f"{base_url.database}_test")

    admin_engine = create_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": test_url.database},
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{test_url.database}"'))
    finally:
        admin_engine.dispose()
    return test_url


def alembic_config(database_url: URL) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["database_url"] = database_url
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture
def alembic_cfg(test_database_url: URL) -> Config:
    return alembic_config(test_database_url)


@pytest.fixture(scope="session")
def migrated_engine(test_database_url: URL) -> Iterator[Engine]:
    """Rebuild the test schema from migrations (not create_all), so migrations are what's tested."""
    config = alembic_config(test_database_url)
    command.downgrade(config, "base")
    command.upgrade(config, "head")

    engine = create_engine(test_database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(migrated_engine: Engine) -> Iterator[Session]:
    """A session inside a transaction that is rolled back after each test.

    Commits and rollbacks inside the test only touch a savepoint.
    """
    with migrated_engine.connect() as connection:
        transaction = connection.begin()
        session = Session(
            bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()


@pytest.fixture
def mailbox() -> RecordingEmailSender:
    return RecordingEmailSender()


@pytest.fixture
def fake_stt() -> FakeStt:
    return FakeStt()


@pytest.fixture
def fake_tts() -> FakeTts:
    return FakeTts()


@pytest.fixture
def speech(fake_stt: FakeStt, fake_tts: FakeTts, tmp_path: Path) -> SpeechServices:
    """Fake STT/TTS (no models needed); real ffmpeg decoding, caching and mixing."""
    return SpeechServices(
        stt=fake_stt, tts=fake_tts, cache=TtsCache(tmp_path / "tts"), max_seconds=15.0
    )


@pytest.fixture
def app(test_settings: Settings, mailbox: RecordingEmailSender, speech: SpeechServices) -> FastAPI:
    app = create_app(test_settings)
    app.state.email_sender = mailbox
    app.state.speech = speech
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def db_client(app: FastAPI, db_session: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Iterator[None]:
    yield
    get_settings.cache_clear()


AuthHeaders = Callable[[User | Child], dict[str, str]]


@pytest.fixture
def auth_headers(test_settings: Settings) -> AuthHeaders:
    """Bearer headers for a user or child, minted directly (login itself is tested separately)."""

    def make(account: User | Child) -> dict[str, str]:
        if isinstance(account, Child):
            principal = Principal(kind=PrincipalKind.CHILD, id=account.id)
        else:
            principal = Principal(kind=kind_for_role(account.role), id=account.id)
        token = create_access_token(
            principal, secret_key=test_settings.secret_key(), ttl=timedelta(minutes=5)
        )
        return {"Authorization": f"Bearer {token}"}

    return make
