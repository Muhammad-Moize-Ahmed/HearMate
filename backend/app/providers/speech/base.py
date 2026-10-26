from dataclasses import dataclass
from typing import Protocol

from .audio import AudioClip


@dataclass(frozen=True, slots=True)
class Transcription:
    text: str
    confidence: float | None  # 0-1 where the provider reports it
    provider: str


class SttProvider(Protocol):
    name: str

    def transcribe(self, clip: AudioClip) -> Transcription: ...

    def available(self) -> bool: ...


class TtsProvider(Protocol):
    # Part of the cache key: changing the voice must not reuse old audio.
    voice_id: str

    def synthesize(self, text: str) -> bytes:
        """Audio for `text` in any format ffmpeg can read (usually WAV)."""
        ...

    def available(self) -> bool: ...
