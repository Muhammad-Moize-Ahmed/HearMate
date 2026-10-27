"""Sound-effect files in any format: decoded with real ffmpeg, trimmed and cached in memory.

The test files are generated with ffmpeg (tones and silence); no real recordings are used.
"""

import logging
import os
from pathlib import Path

import numpy as np
import pytest

from app.cli import main as cli
from app.core.errors import AppError
from app.modules.games import sounds
from app.modules.games.sounds import MAX_CLIP_SECONDS, SoundLibrary, preload_bank_sounds
from app.modules.games.stimulus import SoundUnavailableError, render_stimulus
from app.providers.speech.audio import (
    SAMPLE_RATE,
    AudioClip,
    AudioFileError,
    InvalidAudioError,
    decode,
    decode_file,
    read_wav,
)
from tests.ffmpeg import make_sound

pytestmark = pytest.mark.usefixtures("ffmpeg")  # skips locally, fails in CI


@pytest.mark.parametrize(
    ("codec", "rate", "channels"),
    [
        ("pcm_s16le", 44_100, 2),
        ("pcm_s24le", 96_000, 1),
        ("pcm_s24le", 48_000, 2),
        ("pcm_s32le", 48_000, 1),
        ("pcm_f32le", 44_100, 2),
        ("pcm_u8", 22_050, 1),
    ],
)
def test_wav_at_any_bit_depth_rate_and_channels_loads_as_16k_mono(
    tmp_path: Path, codec: str, rate: int, channels: int
) -> None:
    make_sound(tmp_path / "dog.wav", codec, rate=rate, channels=channels)

    clip = SoundLibrary(tmp_path).clip("dog")

    assert clip is not None
    assert 950 <= clip.duration_ms <= 1050
    # The tone: lavfi sine peaks at 0.125, and 0.088 after the -3 dB upmix to stereo.
    assert 0.08 < float(np.max(np.abs(clip.samples))) < 0.13


@pytest.mark.parametrize(
    ("extension", "codec"),
    [("mp3", "libmp3lame"), ("m4a", "aac"), ("ogg", "libopus"), ("flac", "flac")],
)
def test_compressed_files_load(tmp_path: Path, extension: str, codec: str) -> None:
    make_sound(tmp_path / f"bird.{extension}", codec, rate=48_000, channels=2)

    clip = SoundLibrary(tmp_path).clip("bird")

    assert clip is not None
    assert 900 <= clip.duration_ms <= 1150  # encoders add a few ms of priming


def test_leading_silence_is_skipped_and_long_files_are_cut(tmp_path: Path) -> None:
    make_sound(tmp_path / "rain.wav", "pcm_s24le", seconds=30, rate=48_000, leading_silence=2.0)

    clip = SoundLibrary(tmp_path).clip("rain")

    assert clip is not None
    assert clip.duration_ms == MAX_CLIP_SECONDS * 1000
    # At most 100 ms of silence is kept before the sound starts (not the 2 s in the file).
    first_sound = int(np.argmax(np.abs(clip.samples) > 0.01))
    assert first_sound <= 0.11 * SAMPLE_RATE
    # The cut is faded out, so it doesn't end in a click.
    assert float(np.max(np.abs(clip.samples[-20:]))) < 0.01
    assert float(np.max(np.abs(clip.samples[-SAMPLE_RATE : -SAMPLE_RATE // 2]))) > 0.1


def test_the_upload_limit_still_rejects_what_the_library_trims(tmp_path: Path) -> None:
    path = make_sound(tmp_path / "wind.wav", "pcm_s16le", seconds=25)

    library_clip = SoundLibrary(tmp_path).clip("wind")
    assert library_clip is not None
    assert library_clip.duration_ms == MAX_CLIP_SECONDS * 1000

    # The same audio as a child's recording: still refused, with the upload's own message.
    with pytest.raises(InvalidAudioError) as excinfo:
        decode(path.read_bytes(), max_seconds=15)
    assert excinfo.value.code == "audio_too_long"
    assert excinfo.value.message == "Recordings can be at most 15 seconds"


def test_library_file_errors_are_not_api_errors(tmp_path: Path) -> None:
    (tmp_path / "bell.wav").write_bytes(b"RIFF....WAVEjunk")

    with pytest.raises(AudioFileError) as excinfo:
        decode_file(tmp_path / "bell.wav", max_seconds=MAX_CLIP_SECONDS)

    assert not isinstance(excinfo.value, AppError)  # never sent to a client as an upload error
    check = SoundLibrary(tmp_path).check("bell")
    assert check.used is None
    assert [p.name for p, _ in check.problems] == ["bell.wav"]


def test_short_files_are_not_padded_or_faded(tmp_path: Path) -> None:
    make_sound(tmp_path / "drum.wav", "pcm_s16le", seconds=0.6)

    clip = SoundLibrary(tmp_path).clip("drum")

    assert clip is not None
    assert 550 <= clip.duration_ms <= 650
    assert float(np.max(np.abs(clip.samples[-200:]))) > 0.1


def test_hidden_files_and_other_extensions_are_ignored(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    (tmp_path / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1" + bytes(100))
    (tmp_path / "._cat.wav").write_bytes(b"\x00\x05\x16\x07 AppleDouble")  # macOS metadata
    make_sound(tmp_path / ".dog.wav", "pcm_s16le")
    make_sound(tmp_path / "cat.wav", "pcm_s16le")
    (tmp_path / "cow.txt").write_text("not a sound")
    (tmp_path / "cow.png").write_bytes(b"\x89PNG")
    library = SoundLibrary(tmp_path)

    with caplog.at_level(logging.WARNING, logger="app.sounds"):
        assert library.clip("cat") is not None
        assert library.clip("dog") is None
        assert library.clip("cow") is None
        assert library.clip(".DS_Store") is None
        assert library.clip("") is None

    assert not caplog.records  # never even tried
    assert library.check("cow").files == []


def test_an_undecodable_file_is_skipped_with_a_warning_naming_it(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    (tmp_path / "cow.wav").write_bytes(b"RIFF\x24\x00\x00\x00WAVEnot really a wav file")
    make_sound(tmp_path / "duck.wav", "pcm_s16le")
    library = SoundLibrary(tmp_path)

    with caplog.at_level(logging.WARNING, logger="app.sounds"):
        assert library.clip("cow") is None
        assert library.clip("cow") is None  # tried once, not on every request
        assert library.clip("duck") is not None  # the others still load

    assert len(caplog.records) == 1
    assert "cow.wav" in caplog.records[0].getMessage()


def test_an_undecodable_file_falls_back_to_another_file_for_the_sound(tmp_path: Path) -> None:
    (tmp_path / "frog.wav").write_bytes(b"garbage")
    make_sound(tmp_path / "frog.mp3", "libmp3lame")

    assert SoundLibrary(tmp_path).clip("frog") is not None


def test_a_bad_file_makes_its_round_unavailable_not_broken(tmp_path: Path) -> None:
    (tmp_path / "lion.wav").write_bytes(b"")
    sounds.sound_library.cache_clear()

    with pytest.raises(SoundUnavailableError):
        render_stimulus({"type": "sound", "sound_id": "lion"}, None, None, tmp_path)  # type: ignore[arg-type]


def test_files_are_decoded_once_and_again_only_when_replaced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []

    def counting_decode(path: Path, *, max_seconds: float) -> AudioClip:
        calls.append(path)
        return decode_file(path, max_seconds=max_seconds)

    monkeypatch.setattr(sounds, "decode_file", counting_decode)
    path = make_sound(tmp_path / "piano.wav", "pcm_s16le")
    library = SoundLibrary(tmp_path)

    for _ in range(3):
        assert library.clip("piano") is not None
    assert calls == [path]

    make_sound(path, "pcm_s24le", seconds=2.0)
    os.utime(path, ns=(1, 1))  # a different modification time, whatever the clock resolution
    replaced = library.clip("piano")
    assert replaced is not None
    assert replaced.duration_ms > 1500
    assert calls == [path, path]


def test_preload_decodes_the_bank_once_and_reports_it(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    make_sound(tmp_path / "dog.wav", "pcm_s24le", seconds=10, rate=96_000, channels=2)
    make_sound(tmp_path / "bird.mp3", "libmp3lame")
    (tmp_path / "cat.wav").write_bytes(b"broken")
    (tmp_path / ".DS_Store").write_bytes(bytes(64))
    sounds.sound_library.cache_clear()

    with caplog.at_level(logging.INFO, logger="app.sounds"):
        report = preload_bank_sounds(tmp_path)

    assert sorted(report.loaded) == ["bird", "dog"]
    assert "cat" not in report.missing  # it has a file; the file is broken (logged)
    assert {"cow", "rain"} <= set(report.missing)
    # Stored as 16-bit: a full clip of dog and about 1 s of bird.
    seconds = report.memory_bytes / (2 * SAMPLE_RATE)
    assert MAX_CLIP_SECONDS + 0.9 < seconds < MAX_CLIP_SECONDS + 1.3
    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "Loaded 2 sounds" in messages
    assert "cat.wav" in messages


def test_the_rendered_round_is_a_plain_16k_mono_16_bit_wav(tmp_path: Path) -> None:
    make_sound(tmp_path / "train.wav", "pcm_f32le", seconds=12, rate=48_000, channels=2)
    sounds.sound_library.cache_clear()

    wav = render_stimulus(
        {"type": "sound", "sound_id": "train"},
        {"kind": "pink", "snr_db": 12.0},
        None,  # type: ignore[arg-type]  # not used for sounds
        tmp_path,
    )

    clip = read_wav(wav)  # raises unless 16 kHz, mono, 16-bit
    assert clip.duration_ms == MAX_CLIP_SECONDS * 1000 + 800  # plus the noise before and after


def test_check_sounds_lists_every_sound_and_its_problems(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    make_sound(tmp_path / "rain.wav", "pcm_s24le", seconds=30, rate=48_000, channels=2)
    make_sound(tmp_path / "drum.m4a", "aac", seconds=0.6)
    make_sound(tmp_path / "dog.wav", "pcm_s16le")
    make_sound(tmp_path / "dog.mp3", "libmp3lame")
    (tmp_path / "cat.wav").write_bytes(b"broken")
    make_sound(tmp_path / "doggo.wav", "pcm_s16le")  # a typo: matches no sound id
    (tmp_path / ".DS_Store").write_bytes(bytes(64))

    assert cli(["check-sounds", "--dir", str(tmp_path)]) == 1  # not every sound is ready
    lines = {line.split()[0]: line for line in capsys.readouterr().out.splitlines() if line}

    assert "rain.wav" in lines["rain"]
    assert f"{MAX_CLIP_SECONDS:.2f}s" in lines["rain"]
    assert "trimmed" in lines["rain"]
    assert "drum.m4a" in lines["drum"]
    assert "trimmed" not in lines["drum"]
    assert "dog.mp3 not used" in lines["dog"]
    assert "NOT PLAYABLE" in lines["cat"]
    assert "cat.wav:" in lines["cat"]
    assert "MISSING" in lines["cow"]
    assert "doggo.wav" in lines["Not"]
    assert ".DS_Store" not in "\n".join(lines.values())
    assert lines["3/24"] == "3/24 sounds ready."
