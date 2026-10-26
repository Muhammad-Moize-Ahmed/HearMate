"""Word- and phoneme-level pronunciation scoring.

Words are compared through their sounds (CMU Pronouncing Dictionary, ARPAbet phonemes), so
"bat" for "pat" scores as one wrong sound rather than one wrong letter, and the sounds a child
missed most can be reported (e.g. "P"). Words not in the dictionary fall back to letters.
"""

import difflib
import re
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache

import cmudict

_NON_WORD = re.compile(r"[^a-z0-9' ]+")
_STRESS = re.compile(r"\d")


@dataclass(frozen=True, slots=True)
class WordScore:
    expected: str
    heard: str | None
    score: float  # 0-100
    missed_sounds: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PronunciationResult:
    score: float  # 0-100, mean over the expected words
    words: list[WordScore]
    practise_sounds: list[str]  # most frequently missed sounds, most common first


def normalize_words(text: str) -> list[str]:
    return _NON_WORD.sub(" ", text.lower()).split()


@lru_cache(maxsize=1)
def _dictionary() -> dict[str, list[list[str]]]:
    raw: dict[str, list[list[str]]] = cmudict.dict()
    return raw


@lru_cache(maxsize=4096)
def pronunciations(word: str) -> tuple[tuple[str, ...], ...]:
    """ARPAbet pronunciations without stress marks, e.g. "cat" -> (("K", "AE", "T"),)."""
    variants = _dictionary().get(word.lower(), [])
    return tuple(tuple(_STRESS.sub("", p) for p in variant) for variant in variants)


def score_word(expected: str, heard: str) -> WordScore:
    if expected == heard:
        return WordScore(expected, heard, 100.0)
    want, got = pronunciations(expected), pronunciations(heard)
    if not want or not got:
        ratio = difflib.SequenceMatcher(None, expected, heard).ratio()
        return WordScore(expected, heard, round(100 * ratio, 1))

    best: tuple[float, list[str]] = (-1.0, [])
    for target in want:
        for said in got:
            matcher = difflib.SequenceMatcher(None, target, said, autojunk=False)
            missed = [
                sound
                for tag, i1, i2, _j1, _j2 in matcher.get_opcodes()
                if tag in ("replace", "delete")
                for sound in target[i1:i2]
            ]
            if matcher.ratio() > best[0]:
                best = (matcher.ratio(), missed)
    return WordScore(expected, heard, round(100 * best[0], 1), best[1])


def _missed_entirely(expected: str) -> WordScore:
    variants = pronunciations(expected)
    return WordScore(expected, None, 0.0, list(variants[0]) if variants else [])


def score_pronunciation(expected_text: str, transcript: str) -> PronunciationResult:
    want, got = normalize_words(expected_text), normalize_words(transcript)
    if not want:
        return PronunciationResult(0.0, [], [])

    words: list[WordScore]
    if not got:
        words = [_missed_entirely(w) for w in want]
    elif len(want) == 1:
        # Best match among what was heard, so "um, cat" still scores well for "cat".
        words = [max((score_word(want[0], h) for h in got), key=lambda w: w.score)]
    else:
        words = []
        matcher = difflib.SequenceMatcher(None, want, got, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                words.extend(WordScore(w, w, 100.0) for w in want[i1:i2])
            elif tag == "replace":
                said = got[j1:j2]
                for k, expected in enumerate(want[i1:i2]):
                    words.append(
                        score_word(expected, said[k])
                        if k < len(said)
                        else _missed_entirely(expected)
                    )
            elif tag == "delete":
                words.extend(_missed_entirely(w) for w in want[i1:i2])
            # "insert" (extra words) is not penalised.

    score = round(sum(w.score for w in words) / len(words), 1)
    counts = Counter(sound for w in words for sound in w.missed_sounds)
    return PronunciationResult(score, words, [sound for sound, _ in counts.most_common(3)])
