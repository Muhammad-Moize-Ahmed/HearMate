import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

# Per-user cache for downloaded models and generated audio (never inside the repo).
USER_CACHE_DIR = Path.home() / ".cache" / "hearmate"

# Later files win: the shared root .env (also used by docker compose), then backend/.env overrides.
ENV_FILES = (REPO_ROOT / ".env", BACKEND_DIR / ".env")

MIN_SECRET_KEY_LENGTH = 32

logger = logging.getLogger(__name__)

Environment = Literal["development", "test", "production"]
LogFormat = Literal["json", "console"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILES,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    ENVIRONMENT: Environment = "development"
    API_PREFIX: str = "/api"

    # Signs tokens (Phase 2). Required in production; generated per process in development.
    SECRET_KEY: SecretStr | None = None

    # Either a full DATABASE_URL, or the POSTGRES_* parts shared with docker-compose.yml.
    DATABASE_URL: SecretStr | None = None
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "hearmate"
    POSTGRES_USER: str = "hearmate"
    POSTGRES_PASSWORD: SecretStr | None = None
    DB_POOL_SIZE: int = Field(default=5, ge=1)
    DB_ECHO: bool = False

    # Comma-separated in env, e.g. "http://localhost:5173,https://hearmate.app".
    CORS_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: LogFormat | None = None

    # --- Auth ---
    ACCESS_TOKEN_TTL_MINUTES: int = Field(default=15, ge=1, le=60)
    REFRESH_TOKEN_TTL_DAYS: int = Field(default=14, ge=1, le=90)
    # One-time codes (email verification, password reset)
    OTP_TTL_MINUTES: int = Field(default=15, ge=1, le=60)
    OTP_MAX_ATTEMPTS: int = Field(default=5, ge=1)
    OTP_RESEND_COOLDOWN_SECONDS: int = Field(default=60, ge=0)
    # Lock a parent/therapist/admin or child account after this many wrong passwords/PINs in a row.
    LOGIN_MAX_FAILURES: int = Field(default=5, ge=1)
    LOGIN_LOCKOUT_MINUTES: int = Field(default=15, ge=1)
    # Refresh-token cookie. Use SameSite=none (with Secure) only if frontend and API are on
    # different sites; the default suits the Vite proxy and a same-site deployment.
    REFRESH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    REFRESH_COOKIE_SECURE: bool | None = None

    # --- Email ---
    # "console" logs emails (development only); "smtp" sends them.
    EMAIL_BACKEND: Literal["console", "smtp"] = "console"
    EMAIL_FROM: str = "HearMate <no-reply@hearmate.local>"
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: SecretStr | None = None
    SMTP_STARTTLS: bool = True

    # --- Speech (Phase 5) ---
    # Model files and generated audio live outside the repo by default.
    STT_PROVIDER: Literal["whisper", "azure", "none"] = "whisper"
    WHISPER_MODEL: str = "base.en"  # downloaded to the Hugging Face cache on first use
    WHISPER_COMPUTE_TYPE: str = "int8"
    WHISPER_CPU_THREADS: int = Field(default=0, ge=0)  # 0 = let CTranslate2 decide
    STT_MAX_CONCURRENCY: int = Field(default=2, ge=1)  # transcriptions running at once
    TTS_PROVIDER: Literal["piper", "azure", "none"] = "piper"
    PIPER_VOICE: str = "en_US-lessac-medium"
    PIPER_VOICE_DIR: Path = USER_CACHE_DIR / "piper"
    TTS_CACHE_DIR: Path = USER_CACHE_DIR / "tts"
    # Licensed sound-effect files named <sound_id>.wav|.mp3|.ogg (none ship with the repo).
    SOUNDS_DIR: Path | None = None
    AZURE_SPEECH_KEY: SecretStr | None = None
    AZURE_SPEECH_REGION: str | None = None
    AZURE_TTS_VOICE: str = "en-IN-NeerjaNeural"
    AZURE_STT_LANGUAGE: str = "en-IN"
    SPEECH_MAX_UPLOAD_BYTES: int = Field(default=2_000_000, ge=10_000)
    SPEECH_MAX_SECONDS: float = Field(default=15.0, gt=0, le=60)

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("LOG_LEVEL")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def _check_azure_speech(self) -> "Settings":
        uses_azure = "azure" in (self.STT_PROVIDER, self.TTS_PROVIDER)
        if uses_azure and not (self.AZURE_SPEECH_KEY and self.AZURE_SPEECH_REGION):
            raise ValueError(
                "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required for Azure speech"
            )
        return self

    @model_validator(mode="after")
    def _check_production_safety(self) -> "Settings":
        if self.ENVIRONMENT != "production":
            return self

        secret = self.SECRET_KEY.get_secret_value() if self.SECRET_KEY else ""
        if len(secret) < MIN_SECRET_KEY_LENGTH:
            raise ValueError(
                f"SECRET_KEY must be set to at least {MIN_SECRET_KEY_LENGTH} random characters "
                'in production (e.g. python -c "import secrets; print(secrets.token_urlsafe(48))")'
            )
        if self.DATABASE_URL is None and self.POSTGRES_PASSWORD is None:
            raise ValueError("DATABASE_URL or POSTGRES_PASSWORD must be set in production")
        if "*" in self.CORS_ORIGINS:
            raise ValueError("CORS_ORIGINS must list explicit origins in production, not '*'")
        if self.EMAIL_BACKEND != "smtp" or not self.SMTP_HOST:
            raise ValueError("EMAIL_BACKEND=smtp and SMTP_HOST are required in production")
        if self.REFRESH_COOKIE_SECURE is False:
            raise ValueError("REFRESH_COOKIE_SECURE cannot be false in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def refresh_cookie_secure(self) -> bool:
        if self.REFRESH_COOKIE_SECURE is not None:
            return self.REFRESH_COOKIE_SECURE
        return self.is_production or self.REFRESH_COOKIE_SAMESITE == "none"

    @property
    def log_format(self) -> LogFormat:
        if self.LOG_FORMAT is not None:
            return self.LOG_FORMAT
        return "json" if self.is_production else "console"

    @property
    def database_url(self) -> URL:
        if self.DATABASE_URL is not None:
            url = make_url(self.DATABASE_URL.get_secret_value())
            # Always use the psycopg 3 driver, even for plain "postgresql://" URLs from a host.
            if url.drivername in ("postgres", "postgresql"):
                url = url.set(drivername="postgresql+psycopg")
            return url
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD.get_secret_value() if self.POSTGRES_PASSWORD else None,
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )

    def secret_key(self) -> str:
        if self.SECRET_KEY is None:
            # Only reachable outside production (see validator). Tokens die on restart.
            generated = secrets.token_urlsafe(48)
            self.SECRET_KEY = SecretStr(generated)
            logger.warning("SECRET_KEY not set; using a random key for this process only")
        return self.SECRET_KEY.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
