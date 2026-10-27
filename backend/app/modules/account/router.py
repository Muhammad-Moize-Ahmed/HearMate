from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status

from ...auth.deps import DbSession, require_kinds
from ...auth.principal import Principal, PrincipalKind
from ...auth.rate_limit import RateLimiter
from ...core.deps import AppSettings, ClientIp, Limiter, Mailer
from ...providers.email import send_safely
from ..auth.router import clear_refresh_cookie
from .schemas import ConfirmPasswordIn, DeletionSummaryOut
from .service import AccountService

router = APIRouter(prefix="/account", tags=["account"])

MINUTE = 60
HOUR = 60 * MINUTE

# Admins can't delete accounts (theirs included) and children can't delete anything: 403.
AdultPrincipal = Annotated[
    Principal, Depends(require_kinds(PrincipalKind.PARENT, PrincipalKind.THERAPIST))
]


def get_account_service(
    db: DbSession, settings: AppSettings, principal: AdultPrincipal, ip: ClientIp
) -> AccountService:
    return AccountService(db, settings, principal, client_ip=ip)


Service = Annotated[AccountService, Depends(get_account_service)]


def limit_deletions(limiter: RateLimiter, principal: Principal, ip: str | None) -> None:
    """On top of the password lockout (shared with login): few tries per IP and per account."""
    limiter.hit(f"delete:ip:{ip}", limit=10, window_seconds=HOUR)
    limiter.hit(f"delete:id:{principal.id}", limit=5, window_seconds=15 * MINUTE)


def send_outbox(service: AccountService, mailer: Mailer, background: BackgroundTasks) -> None:
    for message in service.outbox:
        background.add_task(send_safely, mailer, message)


@router.get("/deletion-summary")
def deletion_summary(service: Service) -> DeletionSummaryOut:
    """What deleting this account would remove (parent) or end (therapist)."""
    return service.deletion_summary()


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: ConfirmPasswordIn,
    service: Service,
    limiter: Limiter,
    ip: ClientIp,
    mailer: Mailer,
    background: BackgroundTasks,
    settings: AppSettings,
) -> Response:
    """Delete this account now and for good, then sign out every device.

    Parent: the account and every child's data. Therapist: the account, links and invitations;
    their notes and learning plans stay with each child, by a former therapist. A wrong password
    is 403 `wrong_password`.
    """
    limit_deletions(limiter, service.principal, ip)
    service.delete_account(body.password)
    send_outbox(service, mailer, background)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["Cache-Control"] = "no-store"
    clear_refresh_cookie(response, settings)
    return response
