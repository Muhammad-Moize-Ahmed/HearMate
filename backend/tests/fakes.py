import re

from app.providers.email import EmailMessage

_CODE = re.compile(r"\b(\d{6})\b")


class RecordingEmailSender:
    """Keeps sent emails in memory so tests can read codes out of them."""

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.sent.append(message)

    def to(self, address: str) -> list[EmailMessage]:
        return [m for m in self.sent if m.to == address]

    def last_code_for(self, address: str) -> str:
        for message in reversed(self.to(address)):
            if match := _CODE.search(message.body):
                return match.group(1)
        raise AssertionError(f"no code was emailed to {address}")
