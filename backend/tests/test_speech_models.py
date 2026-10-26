"""Real Piper + Whisper round trips. Opt-in (needs the downloaded models):

uv run python -m app.cli speech-setup
HEARMATE_SPEECH_MODELS=1 uv run pytest tests/test_speech_models.py
"""

import os
from functools import lru_cache

import pytest

from app.core.config import Settings
from app.modules.games.noise import NoiseKind, noise_samples
from app.modules.games.pronunciation import score_pronunciation
from app.providers.speech import SpeechServices, build_speech_services
from app.providers.speech.audio import mix_with_noise, to_wav

pytestmark = pytest.mark.skipif(
    os.environ.get("HEARMATE_SPEECH_MODELS") != "1",
    reason="set HEARMATE_SPEECH_MODELS=1 to run against the real speech models",
)


@lru_cache(maxsize=1)
def services() -> SpeechServices:
    speech = build_speech_services(Settings())
    if not (speech.tts and speech.tts.available() and speech.stt and speech.stt.available()):
        pytest.skip("speech models not downloaded (python -m app.cli speech-setup)")
    return speech


@pytest.mark.parametrize(
    "text",
    ["rabbit", "umbrella", "butterfly", "The bus is very big.", "Please open the window."],
)
def test_piper_speech_is_recognised_by_whisper(text: str) -> None:
    speech = services()

    transcription, _ = speech.transcribe(to_wav(speech.speak(text)))

    assert score_pronunciation(text, transcription.text).score >= 75, transcription.text


def test_speech_in_moderate_noise_is_still_recognised() -> None:
    speech = services()
    noisy = mix_with_noise(
        speech.speak("The fish swims in the water."), noise_samples(NoiseKind.PINK), 15.0
    )

    transcription, _ = speech.transcribe(to_wav(noisy))

    assert score_pronunciation("The fish swims in the water.", transcription.text).score >= 60
