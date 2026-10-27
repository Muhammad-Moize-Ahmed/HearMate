"""Sound-effect files from SOUNDS_DIR, decoded once and kept in memory.

A file is `<sound_id>.<ext>` with one of SOUND_EXTENSIONS (.wav at any bit depth or rate, .mp3,
.m4a, .ogg, .flac, .aiff). Each is decoded to 16 kHz mono 16-bit, its leading silence is skipped
and it is cut to MAX_CLIP_SECONDS, so a library file is never rejected for its length (unlike a
speech upload). The files themselves are never changed.
"""

import logging
import os
import threading
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import numpy.typing as npt

from ...providers.speech.audio import (
    SAMPLE_RATE,
    AudioClip,
    AudioFileError,
    SpeechUnavailableError,
    decode_file,
    fade_out,
)
from .content import load_bank

logger = logging.getLogger("app.sounds")

# 4 s: two or three cycles of a sound that repeats (a dog's barks, a clock's ticks, a ringing
# phone), which is what makes it recognisable, while a round stays short for a child's attention
# and replaying it is quick. One-shot sounds (a drum hit, a horn) are shorter and kept whole.
# Noisy rounds add 0.4 s of noise before and after.
MAX_CLIP_SECONDS = 4.0
FADE_OUT_MS = 100  # only when a clip was cut
# The only files tried. With two files for one sound, lossless wins; a file that can't be decoded
# falls back to the next.
SOUND_EXTENSIONS = (".wav", ".flac", ".aiff", ".m4a", ".mp3", ".ogg")

Pcm = npt.NDArray[np.int16]


@dataclass(frozen=True, slots=True)
class _Decoded:
    stamp: tuple[int, int]  # (mtime_ns, size): a replaced file is decoded again
    pcm: Pcm | None  # None: couldn't be decoded (already logged)
    problem: str | None = None
    cut: bool = False


@dataclass(frozen=True, slots=True)
class SoundCheck:
    """What the library makes of one sound id (for `python -m app.cli check-sounds`)."""

    sound_id: str
    files: list[Path]  # every candidate, preferred first
    used: Path | None
    duration_ms: int | None
    cut: bool
    problems: list[tuple[Path, str]]


@dataclass(frozen=True, slots=True)
class PreloadReport:
    loaded: list[str]
    missing: list[str]
    seconds: float
    memory_bytes: int


class SoundLibrary:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self._decoded: dict[Path, _Decoded] = {}
        self._lock = threading.Lock()

    def clip(self, sound_id: str) -> AudioClip | None:
        """The sound, or None if no file for it can be decoded."""
        for path in self._files().get(sound_id, []):
            pcm = self._load(path).pcm
            if pcm is not None:
                return AudioClip(pcm.astype(np.float32) / 32768.0)
        return None

    def check(self, sound_id: str) -> SoundCheck:
        """Which file the sound would come from, the clip it gives, and any file that failed."""
        files = self._files().get(sound_id, [])
        problems: list[tuple[Path, str]] = []
        for path in files:
            decoded = self._load(path)
            if decoded.pcm is not None:
                duration_ms = round(1000 * len(decoded.pcm) / SAMPLE_RATE)
                return SoundCheck(sound_id, files, path, duration_ms, decoded.cut, problems)
            problems.append((path, decoded.problem or "couldn't be decoded"))
        return SoundCheck(sound_id, files, None, None, False, problems)

    def unused_files(self, sound_ids: Iterable[str]) -> list[Path]:
        """Sound files whose name matches no sound id (e.g. a typo), so they are never played."""
        wanted = set(sound_ids)
        return [p for stem, paths in self._files().items() if stem not in wanted for p in paths]

    def preload(self, sound_ids: Iterable[str]) -> PreloadReport:
        """Decode every file for these sounds now (in parallel), so rounds never wait."""
        started = time.perf_counter()
        files = self._files()
        ids = list(sound_ids)
        workers = min(8, os.cpu_count() or 1)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            available = list(pool.map(lambda i: self.clip(i) is not None, ids))
        return PreloadReport(
            loaded=[i for i, ok in zip(ids, available, strict=True) if ok],
            missing=[i for i, ok in zip(ids, available, strict=True) if not ok and i not in files],
            seconds=time.perf_counter() - started,
            memory_bytes=self.memory_bytes(),
        )

    def memory_bytes(self) -> int:
        with self._lock:
            return sum(d.pcm.nbytes for d in self._decoded.values() if d.pcm is not None)

    def _files(self) -> dict[str, list[Path]]:
        """Sound id -> its files, preferred first. Only SOUND_EXTENSIONS count; hidden files
        (.DS_Store, ._dog.wav) are skipped.

        Listed on every call (a directory of a few dozen files), so newly added files are found.
        """
        by_id: dict[str, list[Path]] = {}
        try:
            entries = sorted(self.directory.iterdir())
        except OSError:
            return by_id
        for path in entries:
            if (
                not path.name.startswith(".")
                and path.suffix.lower() in SOUND_EXTENSIONS
                and path.is_file()
            ):
                by_id.setdefault(path.stem, []).append(path)
        for paths in by_id.values():
            paths.sort(key=_preference)
        return by_id

    def _load(self, path: Path) -> _Decoded:
        try:
            stat = path.stat()
        except OSError as exc:
            return _Decoded((0, 0), None, f"can't be read ({exc.strerror})")
        stamp = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            cached = self._decoded.get(path)
        if cached is not None and cached.stamp == stamp:
            return cached

        try:
            clip = decode_file(path, max_seconds=MAX_CLIP_SECONDS)
        except SpeechUnavailableError as exc:  # no ffmpeg: not the file's fault, so don't cache
            logger.warning("Can't load sound file %s: %s", path, exc.message)
            return _Decoded(stamp, None, exc.message)
        except AudioFileError as exc:
            logger.warning("Skipping sound file %s: it couldn't be decoded (%s)", path, exc)
            decoded = _Decoded(stamp, None, str(exc))
        else:
            cut = len(clip.samples) >= round(MAX_CLIP_SECONDS * SAMPLE_RATE)
            if cut:
                clip = fade_out(clip, FADE_OUT_MS)
            pcm = (np.clip(clip.samples, -1.0, 1.0) * 32767).astype(np.int16)
            decoded = _Decoded(stamp, pcm, cut=cut)
        with self._lock:
            self._decoded[path] = decoded
        return decoded


def _preference(path: Path) -> tuple[int, str]:
    return SOUND_EXTENSIONS.index(path.suffix.lower()), path.name


@lru_cache
def sound_library(directory: Path) -> SoundLibrary:
    """One library (and so one in-memory cache) per directory, for the whole process."""
    return SoundLibrary(directory)


def preload_bank_sounds(directory: Path) -> PreloadReport:
    """Preload every sound in the content bank and log what was loaded (run at startup)."""
    report = sound_library(directory).preload(s.id for s in load_bank().sounds)
    logger.info(
        "Loaded %d sounds from %s in %.2f s (%.1f MB in memory)",
        len(report.loaded),
        directory,
        report.seconds,
        report.memory_bytes / 1e6,
    )
    if report.missing:
        logger.warning("No sound file in %s for: %s", directory, ", ".join(report.missing))
    return report
