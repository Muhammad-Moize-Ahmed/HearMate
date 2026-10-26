"""Sign-up, email verification, login (adults and children), token refresh and password reset.

Emails are collected in `outbox` and sent by the router only after the transaction commits.
"""

import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.deps import principal_for_user
from ...auth.passwords import burn_verification_time, hash_secret, verify_secret
from ...auth.principal import Principal, PrincipalKind
from ...auth.tokens import (
    codes_match,
    create_access_token,
    hash_one_time_code,
    hash_refresh_token,
    new_one_time_code,
    new_refresh_token,
)
from ...core.audit import record_event
from ...core.config import Settings
from ...core.errors import AppError, AuthenticationError, PermissionDeniedError, RateLimitedError
from ...db.models import (
    Child,
    CodePurpose,
    OneTimeCode,
    RefreshToken,
    TherapistProfile,
    User,
    UserRole,
    UserStatus,
)
from ...providers.email import EmailMessage
from . import emails
from .schemas import SignupIn, TherapistDetailsIn


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    principal: Principal
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


class InvalidCodeError(AppError):
    code = "invalid_code"

    def __init__(self) -> None:
        super().__init__("The code is invalid or has expired")


class AuthService:
    def __init__(self, db: Session, settings: Settings, *, client_ip: str | None = None) -> None:
        self.db = db
        self.settings = settings
        self.client_ip = client_ip
        self.outbox: list[EmailMessage] = []

    # ------------------------------------------------------------------ sign-up & verification

    def signup(self, data: SignupIn) -> None:
        """Always looks the same to the caller, so it can't be used to discover accounts."""
        user = self._user_by_email(data.email)
        if user is not None and user.email_verified_at is not None:
            self.outbox.append(emails.account_already_exists(user.email, user.first_name))
            return

        password_hash = hash_secret(data.password)
        if user is None:
            user = User(
                email=data.email,
                password_hash=password_hash,
                role=UserRole(data.role),
                first_name=data.first_name,
                last_name=data.last_name,
            )
            self.db.add(user)
            try:
                self.db.flush()
            except IntegrityError:  # a concurrent sign-up with the same email won the race
                self.db.rollback()
                return
        else:
            # Unverified account: only whoever reads the emailed code can activate it, and
            # verification also needs this password, so a squatter can't keep a pre-set one.
            user.password_hash = password_hash
            user.role = UserRole(data.role)
            user.first_name = data.first_name
            user.last_name = data.last_name

        self._sync_therapist_profile(user, data.therapist)
        record_event(
            self.db,
            "user_signed_up",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            ip_address=self.client_ip,
            details={"role": user.role.value},
        )
        code = self._issue_code(user, CodePurpose.VERIFY_EMAIL)
        if code is not None:
            self.outbox.append(
                emails.verification_code(
                    user.email, user.first_name, code, self.settings.OTP_TTL_MINUTES
                )
            )
        self.db.commit()

    def resend_verification(self, email: str) -> None:
        user = self._user_by_email(email)
        if user is None or user.email_verified_at is not None:
            return
        code = self._issue_code(user, CodePurpose.VERIFY_EMAIL)
        if code is not None:
            self.outbox.append(
                emails.verification_code(
                    user.email, user.first_name, code, self.settings.OTP_TTL_MINUTES
                )
            )
        self.db.commit()

    def verify_email(self, email: str, password: str, code: str) -> IssuedTokens:
        """Proves both email ownership (code) and the account password, then signs in."""
        user = self._user_by_email(email)
        if user is None:
            burn_verification_time(password)
            raise _invalid_credentials()
        new_hash = self._check_secret(user, password, user.password_hash)
        if new_hash:
            user.password_hash = new_hash
        if user.email_verified_at is None:
            if not self._consume_code(user, CodePurpose.VERIFY_EMAIL, code):
                raise InvalidCodeError()
            user.email_verified_at = self._now()
        return self._complete_user_login(user)

    # ------------------------------------------------------------------ login

    def login(self, email: str, password: str) -> IssuedTokens:
        user = self._user_by_email(email)
        if user is None:
            burn_verification_time(password)
            raise _invalid_credentials()
        new_hash = self._check_secret(user, password, user.password_hash)
        if new_hash:
            user.password_hash = new_hash
        return self._complete_user_login(user)

    def child_login(self, username: str, pin: str) -> IssuedTokens:
        child = self.db.scalar(select(Child).where(Child.username == username))
        if child is None or child.pin_hash is None:
            burn_verification_time(pin)
            raise AuthenticationError("Invalid username or PIN", code="invalid_credentials")
        new_hash = self._check_secret(
            child,
            pin,
            child.pin_hash,
            failure_message="Invalid username or PIN",
        )
        if new_hash:
            child.pin_hash = new_hash

        parent = self.db.get(User, child.parent_id)
        if parent is None or parent.status is not UserStatus.ACTIVE:
            self.db.commit()
            raise PermissionDeniedError("This account has been disabled", code="account_disabled")

        tokens = self._issue_tokens(Principal(kind=PrincipalKind.CHILD, id=child.id))
        record_event(
            self.db,
            "login_succeeded",
            resource_type="child",
            resource_id=child.id,
            actor_child_id=child.id,
            child_id=child.id,
            ip_address=self.client_ip,
        )
        self.db.commit()
        return tokens

    # ------------------------------------------------------------------ refresh & logout

    def refresh(self, raw_token: str | None) -> IssuedTokens:
        """Rotate the refresh token. Presenting an already-used token revokes its whole family."""
        token = self._refresh_token(raw_token, lock=True)
        if token is None:
            raise _invalid_refresh_token()

        if token.revoked_at is not None:
            # Reuse means the token was copied: end every session in this login chain.
            self._revoke_family(token.family_id)
            record_event(
                self.db,
                "refresh_token_reused",
                resource_type="refresh_token_family",
                resource_id=token.family_id,
                actor_user_id=token.user_id,
                actor_child_id=token.child_id,
                ip_address=self.client_ip,
            )
            self.db.commit()
            raise _invalid_refresh_token()

        if token.expires_at <= self._now():
            raise _invalid_refresh_token()

        principal = self._principal_for_refresh_token(token)
        if principal is None:
            self._revoke_family(token.family_id)
            self.db.commit()
            raise _invalid_refresh_token()

        token.revoked_at = self._now()
        tokens = self._issue_tokens(principal, family_id=token.family_id)
        self.db.commit()
        return tokens

    def logout(self, raw_token: str | None) -> None:
        token = self._refresh_token(raw_token)
        if token is None:
            return
        self._revoke_family(token.family_id)
        record_event(
            self.db,
            "logout",
            resource_type="refresh_token_family",
            resource_id=token.family_id,
            actor_user_id=token.user_id,
            actor_child_id=token.child_id,
            ip_address=self.client_ip,
        )
        self.db.commit()

    # ------------------------------------------------------------------ password reset

    def forgot_password(self, email: str) -> None:
        """Always looks the same to the caller, so it can't be used to discover accounts."""
        user = self._user_by_email(email)
        if user is None or user.status is not UserStatus.ACTIVE:
            return
        code = self._issue_code(user, CodePurpose.RESET_PASSWORD)
        if code is not None:
            self.outbox.append(
                emails.password_reset_code(
                    user.email, user.first_name, code, self.settings.OTP_TTL_MINUTES
                )
            )
        self.db.commit()

    def reset_password(self, email: str, code: str, new_password: str) -> None:
        user = self._user_by_email(email)
        if user is None or not self._consume_code(user, CodePurpose.RESET_PASSWORD, code):
            raise InvalidCodeError()

        now = self._now()
        user.password_hash = hash_secret(new_password)
        # The emailed code proves ownership of the address.
        user.email_verified_at = user.email_verified_at or now
        user.failed_login_count = 0
        user.locked_until = None
        # Sign out every existing session.
        self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        record_event(
            self.db,
            "password_reset",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            ip_address=self.client_ip,
        )
        self.db.commit()

    # ------------------------------------------------------------------ helpers

    def _now(self) -> datetime:
        return datetime.now(UTC)

    def _user_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(User.email == email.lower()))

    def _check_secret(
        self,
        account: User | Child,
        secret: str,
        stored_hash: str,
        *,
        failure_message: str = "Invalid email or password",
    ) -> str | None:
        """Check a password/PIN with lockout. Returns a re-hash if the stored one is outdated."""
        now = self._now()
        if account.locked_until is not None and account.locked_until > now:
            retry_after = math.ceil((account.locked_until - now).total_seconds())
            raise RateLimitedError(
                "Too many failed attempts. Please try again later.",
                retry_after_seconds=retry_after,
                code="account_locked",
            )

        valid, new_hash = verify_secret(secret, stored_hash)
        if valid:
            account.failed_login_count = 0
            account.locked_until = None
            return new_hash

        account.failed_login_count += 1
        locked = account.failed_login_count >= self.settings.LOGIN_MAX_FAILURES
        if locked:
            account.failed_login_count = 0
            account.locked_until = now + timedelta(minutes=self.settings.LOGIN_LOCKOUT_MINUTES)
        is_child = isinstance(account, Child)
        record_event(
            self.db,
            "account_locked" if locked else "login_failed",
            resource_type="child" if is_child else "user",
            resource_id=account.id,
            actor_user_id=None if is_child else account.id,
            actor_child_id=account.id if is_child else None,
            child_id=account.id if is_child else None,
            ip_address=self.client_ip,
        )
        self.db.commit()
        raise AuthenticationError(failure_message, code="invalid_credentials")

    def _complete_user_login(self, user: User) -> IssuedTokens:
        if user.status is not UserStatus.ACTIVE:
            self.db.commit()
            raise PermissionDeniedError("This account has been disabled", code="account_disabled")
        if user.email_verified_at is None:
            self.db.commit()
            raise PermissionDeniedError(
                "Please verify your email address first", code="email_not_verified"
            )

        user.last_login_at = self._now()
        tokens = self._issue_tokens(principal_for_user(self.db, user))
        record_event(
            self.db,
            "login_succeeded",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=user.id,
            ip_address=self.client_ip,
        )
        self.db.commit()
        return tokens

    def _issue_tokens(
        self, principal: Principal, *, family_id: uuid.UUID | None = None
    ) -> IssuedTokens:
        raw, digest = new_refresh_token()
        refresh_expires_at = self._now() + timedelta(days=self.settings.REFRESH_TOKEN_TTL_DAYS)
        self.db.add(
            RefreshToken(
                user_id=None if principal.is_child else principal.id,
                child_id=principal.id if principal.is_child else None,
                token_hash=digest,
                family_id=family_id or uuid.uuid4(),
                expires_at=refresh_expires_at,
            )
        )
        access_ttl = timedelta(minutes=self.settings.ACCESS_TOKEN_TTL_MINUTES)
        return IssuedTokens(
            principal=principal,
            access_token=create_access_token(
                principal, secret_key=self.settings.secret_key(), ttl=access_ttl
            ),
            expires_in=int(access_ttl.total_seconds()),
            refresh_token=raw,
            refresh_expires_at=refresh_expires_at,
        )

    def _refresh_token(self, raw_token: str | None, *, lock: bool = False) -> RefreshToken | None:
        if not raw_token:
            return None
        query = select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token))
        if lock:
            query = query.with_for_update()
        return self.db.scalar(query)

    def _revoke_family(self, family_id: uuid.UUID) -> None:
        self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=self._now())
        )

    def _principal_for_refresh_token(self, token: RefreshToken) -> Principal | None:
        if token.child_id is not None:
            child = self.db.get(Child, token.child_id)
            parent = self.db.get(User, child.parent_id) if child else None
            if child is None or parent is None or parent.status is not UserStatus.ACTIVE:
                return None
            return Principal(kind=PrincipalKind.CHILD, id=child.id)

        user = self.db.get(User, token.user_id)
        if user is None or user.status is not UserStatus.ACTIVE or user.email_verified_at is None:
            return None
        return principal_for_user(self.db, user)

    def _issue_code(self, user: User, purpose: CodePurpose) -> str | None:
        """New code for `user`, replacing older ones. None while the resend cooldown runs."""
        now = self._now()
        latest = self._latest_code(user, purpose)
        cooldown = timedelta(seconds=self.settings.OTP_RESEND_COOLDOWN_SECONDS)
        if latest is not None and latest.created_at > now - cooldown:
            return None

        self.db.execute(
            update(OneTimeCode)
            .where(
                OneTimeCode.user_id == user.id,
                OneTimeCode.purpose == purpose,
                OneTimeCode.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        code = new_one_time_code()
        self.db.add(
            OneTimeCode(
                user_id=user.id,
                purpose=purpose,
                code_hash=self._hash_code(code, user, purpose),
                expires_at=now + timedelta(minutes=self.settings.OTP_TTL_MINUTES),
                created_at=now,
            )
        )
        return code

    def _consume_code(self, user: User, purpose: CodePurpose, code: str) -> bool:
        row = self._latest_code(user, purpose, lock=True)
        if (
            row is None
            or row.consumed_at is not None
            or row.expires_at <= self._now()
            or row.attempts >= self.settings.OTP_MAX_ATTEMPTS
        ):
            return False
        if not codes_match(row.code_hash, self._hash_code(code, user, purpose)):
            row.attempts += 1
            self.db.commit()
            return False
        row.consumed_at = self._now()
        return True

    def _latest_code(
        self, user: User, purpose: CodePurpose, *, lock: bool = False
    ) -> OneTimeCode | None:
        query = (
            select(OneTimeCode)
            .where(OneTimeCode.user_id == user.id, OneTimeCode.purpose == purpose)
            .order_by(OneTimeCode.created_at.desc())
            .limit(1)
        )
        if lock:
            query = query.with_for_update()
        return self.db.scalar(query)

    def _hash_code(self, code: str, user: User, purpose: CodePurpose) -> str:
        return hash_one_time_code(
            code, user_id=user.id, purpose=purpose.value, secret_key=self.settings.secret_key()
        )

    def _sync_therapist_profile(self, user: User, details: TherapistDetailsIn | None) -> None:
        profile = self.db.get(TherapistProfile, user.id)
        if user.role is UserRole.THERAPIST:
            if profile is None:
                profile = TherapistProfile(user_id=user.id)
                self.db.add(profile)
            if details is not None:
                profile.license_number = details.license_number
                profile.organization = details.organization
                profile.specialization = details.specialization
        elif profile is not None:
            self.db.delete(profile)


def _invalid_credentials() -> AuthenticationError:
    return AuthenticationError("Invalid email or password", code="invalid_credentials")


def _invalid_refresh_token() -> AuthenticationError:
    return AuthenticationError(
        "Your session has ended. Please sign in again.", code="session_expired"
    )
