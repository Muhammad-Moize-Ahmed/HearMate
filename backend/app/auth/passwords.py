"""Argon2 hashing for passwords and child PINs (via pwdlib)."""

from functools import lru_cache

from pwdlib import PasswordHash

_hasher = PasswordHash.recommended()


def hash_secret(secret: str) -> str:
    return _hasher.hash(secret)


def verify_secret(secret: str, hashed: str) -> tuple[bool, str | None]:
    """Returns (valid, new_hash). `new_hash` is set when the stored hash uses old parameters."""
    return _hasher.verify_and_update(secret, hashed)


@lru_cache
def _dummy_hash() -> str:
    return _hasher.hash("timing-equaliser-not-a-real-password")


def burn_verification_time(secret: str) -> None:
    """Spend the same time as a real check, so unknown accounts can't be found by timing."""
    _hasher.verify(secret, _dummy_hash())
