import json
import urllib.request
from pathlib import Path

import pytest

from app.core.config import Settings
from app.providers.speech import SpeechServices, SpeechUnavailableError, build_speech_services
from app.providers.speech.audio import read_wav
from app.providers.speech.azure import AzureStt, AzureTts
from app.providers.speech.cache import TtsCache
from app.providers.speech.piper_tts import PiperTts
from app.providers.speech.whisper import WhisperStt
from tests.fakes import FakeStt, FakeTts, tone_wav


class RecordingSender:
    def __init__(self, response: bytes) -> None:
        self.response = response
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request) -> bytes:
        self.requests.append(request)
        return self.response


def test_tts_cache_synthesizes_each_text_once(tmp_path: Path) -> None:
    tts = FakeTts()
    cache = TtsCache(tmp_path)

    first = cache.speak(tts, "cat")
    second = cache.speak(tts, "cat")
    cache.speak(tts, "dog")

    assert tts.calls == ["cat", "dog"]
    assert (first.samples == second.samples).all()
    assert len(list(tmp_path.rglob("*.wav"))) == 2
    assert not list(tmp_path.rglob("*.tmp"))


def test_cache_keys_include_the_voice(tmp_path: Path) -> None:
    cache = TtsCache(tmp_path)

    assert cache.path_for("piper:a", "cat") != cache.path_for("piper:b", "cat")


def test_turned_off_providers_say_so(tmp_path: Path) -> None:
    services = SpeechServices(stt=None, tts=None, cache=TtsCache(tmp_path), max_seconds=15)

    with pytest.raises(SpeechUnavailableError):
        services.speak("cat")
    with pytest.raises(SpeechUnavailableError):
        services.transcribe(tone_wav())
    assert services.status() == {
        "stt": {"provider": None, "available": False},
        "tts": {"voice": None, "available": False},
    }


def test_transcribe_decodes_then_recognises(tmp_path: Path) -> None:
    stt = FakeStt("hello")
    services = SpeechServices(stt=stt, tts=FakeTts(), cache=TtsCache(tmp_path), max_seconds=15)

    transcription, clip = services.transcribe(tone_wav(seconds=0.5))

    assert transcription.text == "hello"
    assert clip.duration_ms == 500


def test_piper_without_a_downloaded_voice_is_unavailable(tmp_path: Path) -> None:
    piper = PiperTts("en_US-lessac-medium", tmp_path)

    assert not piper.available()
    with pytest.raises(SpeechUnavailableError, match="speech-setup"):
        piper.synthesize("cat")


def test_factory_follows_settings(tmp_path: Path) -> None:
    default = build_speech_services(Settings(_env_file=None, PIPER_VOICE_DIR=tmp_path))
    off = build_speech_services(Settings(_env_file=None, STT_PROVIDER="none", TTS_PROVIDER="none"))

    assert isinstance(default.stt, WhisperStt) and isinstance(default.tts, PiperTts)
    assert off.stt is None and off.tts is None


def test_azure_needs_a_key_and_region() -> None:
    with pytest.raises(ValueError, match="AZURE_SPEECH_KEY"):
        Settings(_env_file=None, TTS_PROVIDER="azure")


def test_azure_stt_sends_wav_and_reads_the_best_result() -> None:
    sender = RecordingSender(
        json.dumps(
            {"RecognitionStatus": "Success", "NBest": [{"Display": "Cat.", "Confidence": 0.93}]}
        ).encode()
    )
    stt = AzureStt("test-key", "eastus", "en-IN", send=sender)

    result = stt.transcribe(read_wav(tone_wav()))

    assert (result.text, result.confidence, result.provider) == ("Cat.", 0.93, "azure")
    request = sender.requests[0]
    assert request.full_url.startswith("https://eastus.stt.speech.microsoft.com/")
    assert "language=en-IN" in request.full_url
    assert request.get_header("Ocp-apim-subscription-key") == "test-key"
    assert isinstance(request.data, bytes) and request.data[:4] == b"RIFF"


def test_azure_stt_treats_no_match_as_silence() -> None:
    stt = AzureStt(
        "k", "eastus", "en-US", send=RecordingSender(b'{"RecognitionStatus": "NoMatch"}')
    )

    assert stt.transcribe(read_wav(tone_wav())).text == ""


def test_azure_tts_escapes_text_into_ssml() -> None:
    sender = RecordingSender(tone_wav())
    tts = AzureTts("k", "eastus", "en-IN-NeerjaNeural", send=sender)

    audio = tts.synthesize("Tom & <Jerry>")

    assert audio[:4] == b"RIFF"
    body = sender.requests[0].data
    assert isinstance(body, bytes)
    assert b"Tom &amp; &lt;Jerry&gt;" in body
    assert b"en-IN-NeerjaNeural" in body
    assert tts.voice_id == "azure:en-IN-NeerjaNeural"


def test_azure_network_errors_become_unavailable() -> None:
    def failing(_: urllib.request.Request) -> bytes:
        raise urllib.error.URLError("offline")

    with pytest.raises(SpeechUnavailableError):
        AzureTts("k", "eastus", "v", send=failing).synthesize("cat")
