import re

import numpy as np

from app.providers.email import EmailMessage
from app.providers.speech import AudioClip, Transcription
from app.providers.speech.audio import SAMPLE_RATE, to_wav

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


class FakeStt:
    """Speech recognition that 'hears' whatever the test says."""

    name = "fake-stt"

    def __init__(self, transcript: str = "") -> None:
        self.transcript = transcript
        self.calls = 0

    def available(self) -> bool:
        return True

    def transcribe(self, clip: AudioClip) -> Transcription:
        self.calls += 1
        return Transcription(text=self.transcript, confidence=0.9, provider=self.name)


class FakeTts:
    """Text-to-speech that returns a short tone whose length depends on the text."""

    voice_id = "fake:tone"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def available(self) -> bool:
        return True

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        return tone_wav(seconds=0.2 + 0.05 * len(text))


def tone_wav(seconds: float = 0.5, frequency: float = 440.0) -> bytes:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return to_wav(AudioClip((0.3 * np.sin(2 * np.pi * frequency * t)).astype(np.float32)))
