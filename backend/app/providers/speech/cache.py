"""Disk cache for synthesized speech, keyed by voice + text. Stored as 16 kHz mono WAV."""

import hashlib
import os
import tempfile
from pathlib import Path

from .audio import AudioClip, decode, read_wav, to_wav
from .base import TtsProvider

MAX_TTS_SECONDS = 30.0


class TtsCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory.expanduser()

    def path_for(self, voice_id: str, text: str) -> Path:
        digest = hashlib.sha256(f"{voice_id}\n{text}".encode()).hexdigest()
        return self.directory / digest[:2] / f"{digest}.wav"

    def speak(self, tts: TtsProvider, text: str) -> AudioClip:
        path = self.path_for(tts.voice_id, text)
        if path.exists():
            return read_wav(path.read_bytes())
        wav = to_wav(decode(tts.synthesize(text), max_seconds=MAX_TTS_SECONDS))
        self._write_atomically(path, wav)
        return read_wav(wav)  # exactly what later cache hits return

    def _write_atomically(self, path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, path)  # readers never see a half-written file
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
