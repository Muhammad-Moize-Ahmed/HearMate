"""Local neural text-to-speech with Piper. The voice model lives outside the repo."""

import io
import threading
import wave
from pathlib import Path
from typing import Any

from .audio import SpeechUnavailableError


class PiperTts:
    def __init__(self, voice: str, voice_dir: Path) -> None:
        self.voice = voice
        self.voice_dir = voice_dir.expanduser()
        self.voice_id = f"piper:{voice}"
        self._lock = threading.Lock()
        self._model: Any = None

    @property
    def model_path(self) -> Path:
        return self.voice_dir / f"{self.voice}.onnx"

    def available(self) -> bool:
        return self.model_path.exists()

    def download(self) -> Path:
        """Fetch the voice (model + config) into `voice_dir`. Used by `app.cli speech-setup`."""
        from piper.download_voices import download_voice

        self.voice_dir.mkdir(parents=True, exist_ok=True)
        download_voice(self.voice, self.voice_dir)
        return self.model_path

    def synthesize(self, text: str) -> bytes:
        if not self.available():
            raise SpeechUnavailableError(
                "Speech audio is not set up yet (run: python -m app.cli speech-setup)"
            )
        with self._lock:  # one synthesis at a time per voice; results are cached anyway
            if self._model is None:
                from piper import PiperVoice

                self._model = PiperVoice.load(self.model_path)
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav:
                self._model.synthesize_wav(text, wav)
        return buffer.getvalue()
