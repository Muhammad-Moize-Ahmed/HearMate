import logging

from .base import EmailMessage

logger = logging.getLogger("app.email")


class ConsoleEmailSender:
    """Development only: writes emails (including codes) to the log instead of sending them.

    Production settings refuse this backend.
    """

    def send(self, message: EmailMessage) -> None:
        logger.info("Email to %s: %s\n%s", message.to, message.subject, message.body)
