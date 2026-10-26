"""Access tokens (JWT), refresh tokens (opaque) and one-time codes."""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from ..core.errors import AuthenticationError
from .principal import Principal, PrincipalKind

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "hearmate-api"
JWT_AUDIENCE = "hearmate-app"
OTP_DIGITS = 6


def create_access_token(
    principal: Principal, *, secret_key: str, ttl: timedelta, now: datetime | None = None
) -> str:
    issued_at = now or datetime.now(UTC)
    claims = {
        "sub": str(principal.id),
        "kind": principal.kind.value,
        "typ": "access",
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": issued_at,
        "exp": issued_at + ttl,
    }
    return jwt.encode(claims, secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, *, secret_key: str) -> tuple[PrincipalKind, uuid.UUID]:
    """Returns (kind, id). Any problem with the token is the same 401 to the client."""
    try:
        claims = jwt.decode(
            token,
            secret_key,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
            options={"require": ["sub", "kind", "typ", "exp", "iat"]},
        )
        if claims["typ"] != "access":
            raise ValueError("not an access token")
        return PrincipalKind(claims["kind"]), uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise AuthenticationError("Invalid or expired token", code="invalid_token") from exc


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the cookie, hash for the database)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    # 256 bits of randomness, so a fast hash is enough (no brute force possible).
    return hashlib.sha256(raw.encode()).hexdigest()


def new_one_time_code() -> str:
    return f"{secrets.randbelow(10**OTP_DIGITS):0{OTP_DIGITS}d}"


def hash_one_time_code(code: str, *, user_id: uuid.UUID, purpose: str, secret_key: str) -> str:
    """Keyed HMAC: a 6-digit code is trivially brute-forced from a plain hash if the DB leaks."""
    message = f"{purpose}:{user_id}:{code}".encode()
    return hmac.new(secret_key.encode(), message, hashlib.sha256).hexdigest()


def codes_match(code_hash: str, expected_hash: str) -> bool:
    return hmac.compare_digest(code_hash, expected_hash)
