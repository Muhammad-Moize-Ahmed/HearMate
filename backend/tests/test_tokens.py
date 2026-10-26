import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.auth.principal import Principal, PrincipalKind
from app.auth.tokens import (
    JWT_ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_one_time_code,
    hash_refresh_token,
    new_one_time_code,
    new_refresh_token,
)
from app.core.errors import AuthenticationError

SECRET = "s" * 48
PARENT = Principal(kind=PrincipalKind.PARENT, id=uuid.uuid4())


def test_access_token_round_trip() -> None:
    token = create_access_token(PARENT, secret_key=SECRET, ttl=timedelta(minutes=15))

    assert decode_access_token(token, secret_key=SECRET) == (PrincipalKind.PARENT, PARENT.id)


@pytest.mark.parametrize(
    "token",
    [
        create_access_token(PARENT, secret_key=SECRET, ttl=timedelta(seconds=-1)),
        create_access_token(PARENT, secret_key="other" * 10, ttl=timedelta(minutes=5)),
        "not-a-jwt",
    ],
    ids=["expired", "wrong-secret", "garbage"],
)
def test_bad_access_tokens_are_rejected(token: str) -> None:
    with pytest.raises(AuthenticationError) as excinfo:
        decode_access_token(token, secret_key=SECRET)

    assert excinfo.value.code == "invalid_token"


@pytest.mark.parametrize(
    "changes",
    [{"typ": "refresh"}, {"aud": "someone-else"}, {"kind": "superuser"}, {"sub": "not-a-uuid"}],
)
def test_tokens_with_wrong_claims_are_rejected(changes: dict[str, str]) -> None:
    now = datetime.now(UTC)
    claims = {
        "sub": str(PARENT.id),
        "kind": "parent",
        "typ": "access",
        "iss": "hearmate-api",
        "aud": "hearmate-app",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    } | changes
    token = jwt.encode(claims, SECRET, algorithm=JWT_ALGORITHM)

    with pytest.raises(AuthenticationError):
        decode_access_token(token, secret_key=SECRET)


def test_unsigned_tokens_are_rejected() -> None:
    claims = {"sub": str(PARENT.id), "kind": "parent", "typ": "access"}
    token = jwt.encode(claims, key=None, algorithm="none")

    with pytest.raises(AuthenticationError):
        decode_access_token(token, secret_key=SECRET)


def test_refresh_tokens_are_random_and_only_the_hash_is_kept() -> None:
    raw_a, hash_a = new_refresh_token()
    raw_b, _ = new_refresh_token()

    assert raw_a != raw_b
    assert hash_a == hash_refresh_token(raw_a)
    assert raw_a not in hash_a


def test_one_time_codes_are_six_digits() -> None:
    codes = {new_one_time_code() for _ in range(50)}

    assert all(len(c) == 6 and c.isdigit() for c in codes)
    assert len(codes) > 1


def test_code_hashes_are_bound_to_user_purpose_and_key() -> None:
    user = uuid.uuid4()
    base = hash_one_time_code("123456", user_id=user, purpose="verify_email", secret_key=SECRET)

    assert base != hash_one_time_code(
        "123456", user_id=uuid.uuid4(), purpose="verify_email", secret_key=SECRET
    )
    assert base != hash_one_time_code(
        "123456",
        user_id=user,
        purpose="reset_password",
        secret_key=SECRET,  # gitleaks:allow
    )
    assert base != hash_one_time_code(
        "123456", user_id=user, purpose="verify_email", secret_key="k" * 48
    )
