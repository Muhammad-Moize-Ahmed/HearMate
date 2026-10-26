"""Speech services: speech-to-text, text-to-speech (cached) and audio handling.

Providers are created at startup but load their models lazily on first use.
"""

from dataclasses import dataclass
from typing import Any

from ...core.config import Settings
from .audio import AudioClip, InvalidAudioError, SpeechUnavailableError, decode
from .azure import AzureStt, AzureTts
from .base import SttProvider, Transcription, TtsProvider
from .cache import TtsCache
from .piper_tts import PiperTts
from .whisper import WhisperStt

__all__ = [
    "AudioClip",
    "InvalidAudioError",
    "SpeechServices",
    "SpeechUnavailableError",
    "SttProvider",
    "Transcription",
    "TtsProvider",
    "build_speech_services",
]


@dataclass
class SpeechServices:
    stt: SttProvider | None
    tts: TtsProvider | None
    cache: TtsCache
    max_seconds: float

    def transcribe(self, audio: bytes) -> tuple[Transcription, AudioClip]:
        if self.stt is None:
            raise SpeechUnavailableError("Speech recognition is turned off")
        clip = decode(audio, max_seconds=self.max_seconds)
        return self.stt.transcribe(clip), clip

    def speak(self, text: str) -> AudioClip:
        if self.tts is None:
            raise SpeechUnavailableError("Speech audio is turned off")
        return self.cache.speak(self.tts, text)

    def status(self) -> dict[str, Any]:
        return {
            "stt": {
                "provider": self.stt.name if self.stt else None,
                "available": bool(self.stt and self.stt.available()),
            },
            "tts": {
                "voice": self.tts.voice_id if self.tts else None,
                "available": bool(self.tts and self.tts.available()),
            },
        }


def build_speech_services(settings: Settings) -> SpeechServices:
    key = settings.AZURE_SPEECH_KEY.get_secret_value() if settings.AZURE_SPEECH_KEY else ""
    region = settings.AZURE_SPEECH_REGION or ""

    stt: SttProvider | None = None
    if settings.STT_PROVIDER == "whisper":
        stt = WhisperStt(
            settings.WHISPER_MODEL,
            compute_type=settings.WHISPER_COMPUTE_TYPE,
            cpu_threads=settings.WHISPER_CPU_THREADS,
            max_concurrency=settings.STT_MAX_CONCURRENCY,
        )
    elif settings.STT_PROVIDER == "azure":
        stt = AzureStt(key, region, settings.AZURE_STT_LANGUAGE)

    tts: TtsProvider | None = None
    if settings.TTS_PROVIDER == "piper":
        tts = PiperTts(settings.PIPER_VOICE, settings.PIPER_VOICE_DIR)
    elif settings.TTS_PROVIDER == "azure":
        tts = AzureTts(key, region, settings.AZURE_TTS_VOICE)

    return SpeechServices(
        stt=stt,
        tts=tts,
        cache=TtsCache(settings.TTS_CACHE_DIR),
        max_seconds=settings.SPEECH_MAX_SECONDS,
    )
