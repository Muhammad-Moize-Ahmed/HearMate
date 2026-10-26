import logging

from ...core.config import Settings
from .base import EmailMessage, EmailSender
from .console import ConsoleEmailSender
from .smtp import SmtpEmailSender

logger = logging.getLogger("app.email")

__all__ = ["EmailMessage", "EmailSender", "build_email_sender", "send_safely"]


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.EMAIL_BACKEND == "smtp" and settings.SMTP_HOST:
        return SmtpEmailSender(
            host=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            sender=settings.EMAIL_FROM,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD.get_secret_value() if settings.SMTP_PASSWORD else None,
            starttls=settings.SMTP_STARTTLS,
        )
    return ConsoleEmailSender()


def send_safely(sender: EmailSender, message: EmailMessage) -> None:
    """Run as a background task after the response: a mail failure must not crash anything."""
    try:
        sender.send(message)
    except Exception:
        logger.exception("Failed to send email %r", message.subject)
