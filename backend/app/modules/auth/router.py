from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Response, status

from ...auth.deps import CurrentPrincipal, DbSession
from ...auth.principal import Principal
from ...auth.rate_limit import RateLimiter
from ...core.deps import AppSettings, ClientIp, Limiter, Mailer
from ...core.errors import AuthenticationError
from ...db.models import Child, TherapistApprovalStatus, TherapistProfile, User
from ...providers.email import send_safely
from .schemas import (
    ChildLoginIn,
    ChildMeOut,
    EmailIn,
    LoginIn,
    MeOut,
    MessageOut,
    ResetPasswordIn,
    SignupIn,
    TokenOut,
    UserMeOut,
    VerifyEmailIn,
)
from .service import AuthService, IssuedTokens

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "hm_refresh"
CHECK_EMAIL = "Check your email to continue."

MINUTE = 60
HOUR = 60 * MINUTE

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE)]


def get_auth_service(db: DbSession, settings: AppSettings, ip: ClientIp) -> AuthService:
    return AuthService(db, settings, client_ip=ip)


Service = Annotated[AuthService, Depends(get_auth_service)]


def _limit(
    limiter: RateLimiter,
    action: str,
    ip: str | None,
    *,
    per_ip: tuple[int, int],
    per_identity: tuple[str, int, int] | None = None,
) -> None:
    """Limits are (max requests, window seconds); per-identity also catches distributed attempts."""
    limit, window = per_ip
    limiter.hit(f"{action}:ip:{ip}", limit=limit, window_seconds=window)
    if per_identity is not None:
        identity, limit, window = per_identity
        limiter.hit(f"{action}:id:{identity}", limit=limit, window_seconds=window)


def _send_outbox(service: AuthService, mailer: Mailer, background: BackgroundTasks) -> None:
    for message in service.outbox:
        background.add_task(send_safely, mailer, message)


def _refresh_cookie_path(settings: AppSettings) -> str:
    return f"{settings.API_PREFIX}/auth"


def _token_response(
    tokens: IssuedTokens, response: Response, settings: AppSettings, db: DbSession
) -> TokenOut:
    # The refresh token lives only in an httpOnly cookie scoped to /api/auth; the access
    # token is returned in the body and should be kept in memory by the client.
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=settings.REFRESH_TOKEN_TTL_DAYS * 24 * HOUR,
        path=_refresh_cookie_path(settings),
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
    response.headers["Cache-Control"] = "no-store"
    return TokenOut(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        principal=describe_principal(db, tokens.principal),
    )


def describe_principal(db: DbSession, principal: Principal) -> UserMeOut | ChildMeOut:
    if principal.is_child:
        child = db.get(Child, principal.id)
        if child is None:
            raise AuthenticationError("Account no longer available", code="invalid_token")
        return ChildMeOut(
            kind="child", id=child.id, display_name=child.display_name, avatar=child.avatar
        )

    user = db.get(User, principal.id)
    if user is None:
        raise AuthenticationError("Account no longer available", code="invalid_token")
    profile = db.get(TherapistProfile, user.id)
    return UserMeOut(
        kind=principal.kind.value,
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        therapist_status=profile.approval_status if profile else None,
        therapist_rejection_reason=profile.rejection_reason
        if profile and profile.approval_status is TherapistApprovalStatus.REJECTED
        else None,
    )


@router.post("/signup", status_code=status.HTTP_202_ACCEPTED)
def signup(
    body: SignupIn,
    service: Service,
    limiter: Limiter,
    mailer: Mailer,
    ip: ClientIp,
    background: BackgroundTasks,
) -> MessageOut:
    """Create a parent or therapist account and email a verification code.

    The response is the same whether or not the email is already registered.
    """
    _limit(limiter, "signup", ip, per_ip=(10, HOUR), per_identity=(body.email, 5, HOUR))
    service.signup(body)
    _send_outbox(service, mailer, background)
    return MessageOut(message=CHECK_EMAIL)


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    body: EmailIn,
    service: Service,
    limiter: Limiter,
    mailer: Mailer,
    ip: ClientIp,
    background: BackgroundTasks,
) -> MessageOut:
    _limit(limiter, "resend", ip, per_ip=(10, 10 * MINUTE), per_identity=(body.email, 5, HOUR))
    service.resend_verification(body.email)
    _send_outbox(service, mailer, background)
    return MessageOut(message=CHECK_EMAIL)


@router.post("/verify-email")
def verify_email(
    body: VerifyEmailIn,
    service: Service,
    limiter: Limiter,
    ip: ClientIp,
    response: Response,
    settings: AppSettings,
    db: DbSession,
) -> TokenOut:
    """Confirm the emailed code (with the account password) and sign in."""
    _limit(limiter, "verify", ip, per_ip=(20, 10 * MINUTE), per_identity=(body.email, 10, HOUR))
    tokens = service.verify_email(body.email, body.password, body.code)
    return _token_response(tokens, response, settings, db)


@router.post("/login")
def login(
    body: LoginIn,
    service: Service,
    limiter: Limiter,
    ip: ClientIp,
    response: Response,
    settings: AppSettings,
    db: DbSession,
) -> TokenOut:
    """Parent, therapist or admin sign-in with email and password."""
    _limit(
        limiter, "login", ip, per_ip=(20, 10 * MINUTE), per_identity=(body.email, 10, 10 * MINUTE)
    )
    tokens = service.login(body.email, body.password)
    return _token_response(tokens, response, settings, db)


@router.post("/child-login")
def child_login(
    body: ChildLoginIn,
    service: Service,
    limiter: Limiter,
    ip: ClientIp,
    response: Response,
    settings: AppSettings,
    db: DbSession,
) -> TokenOut:
    """Child sign-in with the username and PIN their parent set."""
    _limit(
        limiter,
        "child-login",
        ip,
        per_ip=(20, 10 * MINUTE),
        per_identity=(body.username, 10, 10 * MINUTE),
    )
    tokens = service.child_login(body.username, body.pin)
    return _token_response(tokens, response, settings, db)


@router.post("/refresh")
def refresh(
    service: Service,
    limiter: Limiter,
    ip: ClientIp,
    response: Response,
    settings: AppSettings,
    db: DbSession,
    refresh_token: RefreshCookie = None,
) -> TokenOut:
    """Exchange the refresh cookie for a new access token (and a new refresh cookie)."""
    _limit(limiter, "refresh", ip, per_ip=(60, MINUTE))
    tokens = service.refresh(refresh_token)
    return _token_response(tokens, response, settings, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    service: Service, settings: AppSettings, refresh_token: RefreshCookie = None
) -> Response:
    """End this sign-in (every token in its refresh chain) and clear the cookie."""
    service.logout(refresh_token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, settings)
    return response


def clear_refresh_cookie(response: Response, settings: AppSettings) -> None:
    response.delete_cookie(
        REFRESH_COOKIE,
        path=_refresh_cookie_path(settings),
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    body: EmailIn,
    service: Service,
    limiter: Limiter,
    mailer: Mailer,
    ip: ClientIp,
    background: BackgroundTasks,
) -> MessageOut:
    """Email a reset code. The response is the same whether or not the account exists."""
    _limit(limiter, "forgot", ip, per_ip=(10, 10 * MINUTE), per_identity=(body.email, 5, HOUR))
    service.forgot_password(body.email)
    _send_outbox(service, mailer, background)
    return MessageOut(message=CHECK_EMAIL)


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPasswordIn, service: Service, limiter: Limiter, ip: ClientIp) -> None:
    """Set a new password with the emailed code. Signs out all existing sessions."""
    _limit(limiter, "reset", ip, per_ip=(20, 10 * MINUTE), per_identity=(body.email, 10, HOUR))
    service.reset_password(body.email, body.code, body.new_password)


@router.get("/me")
def me(principal: CurrentPrincipal, db: DbSession) -> MeOut:
    return describe_principal(db, principal)
