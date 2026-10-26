"""Dependencies for per-app objects stored on `app.state` by `create_app`."""

import ipaddress
from typing import Annotated, cast

from fastapi import Depends, Request

from ..auth.rate_limit import RateLimiter
from ..providers.email import EmailSender
from .config import Settings


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_rate_limiter(request: Request) -> RateLimiter:
    return cast(RateLimiter, request.app.state.rate_limiter)


def get_email_sender(request: Request) -> EmailSender:
    return cast(EmailSender, request.app.state.email_sender)


def get_client_ip(request: Request) -> str | None:
    """The caller's IP, or None if the server doesn't know one (e.g. unix socket, test client).

    Behind a reverse proxy, run uvicorn with --proxy-headers so this is the real client.
    """
    host = request.client.host if request.client else None
    if host is None:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


AppSettings = Annotated[Settings, Depends(get_app_settings)]
Limiter = Annotated[RateLimiter, Depends(get_rate_limiter)]
Mailer = Annotated[EmailSender, Depends(get_email_sender)]
ClientIp = Annotated[str | None, Depends(get_client_ip)]
