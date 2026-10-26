"""Optional Azure Speech (REST, no SDK): STT for short clips and TTS. Needs a key and region."""

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from xml.sax.saxutils import escape

from .audio import AudioClip, SpeechUnavailableError, to_wav
from .base import Transcription

TIMEOUT_SECONDS = 15

# Injectable for tests: sends a request, returns the response body.
Sender = Callable[[urllib.request.Request], bytes]


def _send(request: urllib.request.Request) -> bytes:
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        body: bytes = response.read()
        return body


class AzureStt:
    name = "azure"

    def __init__(self, key: str, region: str, language: str, send: Sender = _send) -> None:
        self._key = key
        self._url = (
            f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/"
            f"cognitiveservices/v1?language={language}&format=detailed"
        )
        self._send = send

    def available(self) -> bool:
        return True

    def transcribe(self, clip: AudioClip) -> Transcription:
        request = urllib.request.Request(  # noqa: S310 - fixed https URL
            self._url,
            data=to_wav(clip),
            method="POST",
            headers={
                "Ocp-Apim-Subscription-Key": self._key,
                "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
                "Accept": "application/json",
            },
        )
        try:
            result = json.loads(self._send(request))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise SpeechUnavailableError("Speech recognition is not available") from exc

        if result.get("RecognitionStatus") != "Success":
            return Transcription(text="", confidence=None, provider=self.name)
        best = (result.get("NBest") or [{}])[0]
        return Transcription(
            text=str(best.get("Display") or result.get("DisplayText") or ""),
            confidence=best.get("Confidence"),
            provider=self.name,
        )


class AzureTts:
    def __init__(self, key: str, region: str, voice: str, send: Sender = _send) -> None:
        self._key = key
        self._url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
        self._voice = voice
        self._send = send
        self.voice_id = f"azure:{voice}"

    def available(self) -> bool:
        return True

    def synthesize(self, text: str) -> bytes:
        ssml = (
            f"<speak version='1.0' xml:lang='en-US'><voice name='{escape(self._voice)}'>"
            f"<prosody rate='-10%'>{escape(text)}</prosody></voice></speak>"
        )
        request = urllib.request.Request(  # noqa: S310 - fixed https URL
            self._url,
            data=ssml.encode(),
            method="POST",
            headers={
                "Ocp-Apim-Subscription-Key": self._key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
                "User-Agent": "HearMate",
            },
        )
        try:
            return self._send(request)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise SpeechUnavailableError("Speech audio is not available") from exc
