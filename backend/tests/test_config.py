import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG_SECRET = "x" * 48


def make_settings(**values: object) -> Settings:
    # _env_file=None: never read the developer's real .env in these tests.
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_database_url_is_built_from_postgres_parts_and_escapes_the_password() -> None:
    settings = make_settings(
        POSTGRES_HOST="db.internal",
        POSTGRES_PORT=6543,
        POSTGRES_DB="hm",
        POSTGRES_USER="app",
        POSTGRES_PASSWORD="p@ss/word",
    )

    url = settings.database_url

    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.port, url.database, url.username) == ("db.internal", 6543, "hm", "app")
    assert url.password == "p@ss/word"
    assert "p%40ss%2Fword" in url.render_as_string(hide_password=False)


def test_database_url_setting_wins_and_gets_the_psycopg_driver() -> None:
    settings = make_settings(
        DATABASE_URL="postgresql://u:pw@remote:5432/prod", POSTGRES_HOST="ignored"
    )

    url = settings.database_url

    assert url.drivername == "postgresql+psycopg"
    assert url.host == "remote"


def test_database_url_is_hidden_in_repr() -> None:
    settings = make_settings(DATABASE_URL="postgresql://u:supersecret@h/db")

    assert "supersecret" not in repr(settings)


def test_cors_origins_accepts_a_comma_separated_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, https://hearmate.app")

    assert make_settings().CORS_ORIGINS == ["http://localhost:5173", "https://hearmate.app"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({}, "SECRET_KEY"),
        ({"SECRET_KEY": "too-short"}, "SECRET_KEY"),
        ({"SECRET_KEY": STRONG_SECRET, "POSTGRES_PASSWORD": None}, "POSTGRES_PASSWORD"),
        ({"SECRET_KEY": STRONG_SECRET, "CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
    ],
)
def test_production_refuses_unsafe_configuration(
    overrides: dict[str, object], message: str
) -> None:
    values: dict[str, object] = {"ENVIRONMENT": "production", "POSTGRES_PASSWORD": "pw"}

    with pytest.raises(ValidationError, match=message):
        make_settings(**(values | overrides))


def test_production_accepts_a_safe_configuration() -> None:
    settings = make_settings(
        ENVIRONMENT="production", SECRET_KEY=STRONG_SECRET, POSTGRES_PASSWORD="pw"
    )

    assert settings.secret_key() == STRONG_SECRET
    assert settings.log_format == "json"


def test_development_generates_one_stable_secret_when_unset() -> None:
    settings = make_settings(ENVIRONMENT="development")

    first = settings.secret_key()

    assert len(first) >= 32
    assert settings.secret_key() == first
    assert settings.log_format == "console"
