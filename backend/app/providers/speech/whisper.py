"""Local speech-to-text with faster-whisper (CTranslate2, CPU int8)."""

import math
import threading
from typing import Any

from .audio import AudioClip, SpeechUnavailableError
from .base import Transcription


class WhisperStt:
    name = "whisper"

    def __init__(self, model: str, *, compute_type: str, cpu_threads: int, max_concurrency: int):
        self._model_name = model
        self._compute_type = compute_type
        self._cpu_threads = cpu_threads
        self._max_concurrency = max_concurrency
        self._slots = threading.BoundedSemaphore(max_concurrency)  # protect the CPU
        self._load_lock = threading.Lock()
        self._model: Any = None

    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def load(self) -> Any:
        """Load once (downloads the model to the Hugging Face cache the first time)."""
        with self._load_lock:
            if self._model is None:
                try:
                    from faster_whisper import WhisperModel

                    self._model = WhisperModel(
                        self._model_name,
                        device="cpu",
                        compute_type=self._compute_type,
                        cpu_threads=self._cpu_threads,
                        num_workers=self._max_concurrency,
                    )
                except Exception as exc:
                    raise SpeechUnavailableError("Speech recognition is not available") from exc
            return self._model

    def transcribe(self, clip: AudioClip) -> Transcription:
        model = self.load()
        with self._slots:
            segments, _info = model.transcribe(
                clip.samples,
                language="en",
                beam_size=5,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            segments = list(segments)
        text = " ".join(s.text.strip() for s in segments).strip()
        confidence = (
            sum(math.exp(s.avg_logprob) for s in segments) / len(segments) if segments else None
        )
        return Transcription(text=text, confidence=confidence, provider=self.name)
