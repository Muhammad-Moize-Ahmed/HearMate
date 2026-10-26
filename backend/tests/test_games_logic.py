"""Game logic that needs no database: adaptive rules, scoring, noise, content and definitions."""

import io
import json
import random
import wave

import pytest
from pydantic import ValidationError

from app.db.models import Difficulty
from app.modules.games.adaptive import RollingThresholdStrategy, SessionPerformance
from app.modules.games.content import ContentBank, load_bank
from app.modules.games.definitions import REGISTRY, RoundContext
from app.modules.games.definitions.base import ChoiceAnswer, SequenceAnswer, SpeechAnswer
from app.modules.games.levels import tier_for_level
from app.modules.games.noise import NoiseKind, noise_wav
from app.modules.games.scoring import session_points, speech_similarity

STRATEGY = RollingThresholdStrategy()


def perf(
    accuracy: float, median_ms: int | None = 2000, reference_ms: int = 6000
) -> SessionPerformance:
    return SessionPerformance(accuracy, median_ms, reference_ms)


# ---------------------------------------------------------------- adaptive strategy


@pytest.mark.parametrize(
    ("level", "history", "expected_level", "reason_start"),
    [
        (1, [perf(80)], 2, "Level up"),
        (4, [perf(100), perf(90)], 5, "Level up"),
        (4, [perf(100), perf(40)], 4, "Staying"),  # good today, but the window average is 70%
        (4, [perf(79)], 4, "Staying"),
        (4, [perf(50), perf(55)], 3, "Easier level"),
        (4, [perf(50), perf(90)], 4, "Staying"),  # one bad session after good ones: hold
        (1, [perf(10)], 1, "Keep practising"),
        (9, [perf(100)], 9, "Top level"),
        (4, [perf(100, median_ms=10_000)], 4, "Accurate but slow"),
        (4, [perf(100, median_ms=None)], 5, "Level up"),
    ],
)
def test_rolling_threshold_strategy(
    level: int, history: list[SessionPerformance], expected_level: int, reason_start: str
) -> None:
    decision = STRATEGY.decide(level, history)

    assert decision.new_level == expected_level
    assert decision.reason.startswith(reason_start)


def test_strategy_only_looks_at_the_window() -> None:
    history = [perf(90), perf(90), perf(90), perf(0), perf(0)]

    assert STRATEGY.decide(3, history).new_level == 4


def test_levels_map_to_tiers() -> None:
    assert [tier_for_level(n) for n in (1, 3, 4, 6, 7, 9)] == [
        Difficulty.EASY,
        Difficulty.EASY,
        Difficulty.MEDIUM,
        Difficulty.MEDIUM,
        Difficulty.HARD,
        Difficulty.HARD,
    ]


# ---------------------------------------------------------------- scoring


def test_points_scale_with_difficulty_and_reward_a_perfect_round() -> None:
    assert session_points(8, 8, Difficulty.EASY) == 90
    assert session_points(7, 8, Difficulty.EASY) == 70
    assert session_points(7, 8, Difficulty.HARD) == 210
    assert session_points(0, 8, Difficulty.MEDIUM) == 0


@pytest.mark.parametrize(
    ("expected", "heard", "minimum", "maximum"),
    [
        ("cat", "cat", 100, 100),
        ("cat", "Cat!", 100, 100),
        ("cat", "um cat", 100, 100),
        ("elephant", "elefant", 75, 99),
        ("cat", "dog", 0, 40),
        ("The cat is sleeping.", "the cat is sleeping", 100, 100),
        ("The cat is sleeping.", "the cat sleeping", 75, 99),
        ("The cat is sleeping.", "", 0, 0),
    ],
)
def test_speech_similarity(expected: str, heard: str, minimum: float, maximum: float) -> None:
    assert minimum <= speech_similarity(expected, heard) <= maximum


# ---------------------------------------------------------------- noise


@pytest.mark.parametrize("kind", list(NoiseKind))
def test_noise_is_a_valid_deterministic_wav(kind: NoiseKind) -> None:
    data = noise_wav(kind)

    with wave.open(io.BytesIO(data)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16_000)
        assert wav.getnframes() == 4 * 16_000
    assert noise_wav(kind) == data
    assert noise_wav(NoiseKind.WHITE) != noise_wav(NoiseKind.PINK)


# ---------------------------------------------------------------- content bank


def test_the_shipped_bank_is_valid() -> None:
    bank = load_bank()

    assert bank.version >= 1
    assert bank.words_for(Difficulty.EASY) and bank.pair_sets_for(Difficulty.HARD)


def test_the_bank_rejects_duplicates() -> None:
    raw = json.loads(load_bank().model_dump_json())
    raw["sounds"].append(raw["sounds"][0])

    with pytest.raises(ValidationError, match="duplicate sound ids"):
        ContentBank.model_validate(raw)


# ---------------------------------------------------------------- game definitions


@pytest.mark.parametrize("slug", list(REGISTRY))
@pytest.mark.parametrize("level", range(1, 10))
def test_every_game_builds_valid_rounds_at_every_level(slug: str, level: int) -> None:
    game = REGISTRY[slug]
    ctx = RoundContext(level=level, rng=random.Random(level), bank=load_bank(), with_noise=True)

    rounds = game.build_rounds(ctx)

    assert len(rounds) == game.rounds_per_session
    for spec in rounds:
        option_ids = [o["id"] for o in spec.prompt["options"]]
        assert len(option_ids) == len(set(option_ids))
        if "choice" in spec.expected:
            assert spec.expected["choice"] in option_ids
        if "sequence" in spec.expected:
            assert set(spec.expected["sequence"]) <= set(option_ids)
        has_noise = spec.prompt["noise"] is not None
        assert has_noise == (game.supports_noise or game.always_noise)
        assert (spec.noise_snr_db is not None) == has_noise


def test_rounds_are_reproducible_from_the_seed() -> None:
    game = REGISTRY["sound-detective"]

    def build() -> list[object]:
        ctx = RoundContext(level=5, rng=random.Random(42), bank=load_bank(), with_noise=False)
        return [r.prompt for r in game.build_rounds(ctx)]

    assert build() == build()


def test_listening_in_noise_gets_harder_with_level() -> None:
    game = REGISTRY["listening-in-noise"]
    snrs: list[float] = []
    for level in range(1, 10):
        ctx = RoundContext(level=level, rng=random.Random(1), bank=load_bank(), with_noise=False)
        snr = game.build_rounds(ctx)[0].noise_snr_db
        assert snr is not None
        snrs.append(snr)

    assert snrs == sorted(snrs, reverse=True)
    assert snrs[0] == 20.0


def test_choice_check() -> None:
    game = REGISTRY["sound-detective"]

    assert game.check({"choice": "dog"}, ChoiceAnswer(choice="dog")).is_correct
    assert not game.check({"choice": "dog"}, ChoiceAnswer(choice="cat")).is_correct


def test_sequence_check_gives_partial_credit_but_only_exact_is_correct() -> None:
    game = REGISTRY["word-sequence"]
    expected = {"sequence": ["cat", "sun", "bus"]}

    exact = game.check(expected, SequenceAnswer(sequence=["cat", "sun", "bus"]))
    swapped = game.check(expected, SequenceAnswer(sequence=["cat", "bus", "sun"]))

    assert (exact.is_correct, exact.score) == (True, 100.0)
    assert (swapped.is_correct, swapped.score) == (False, 33.3)


def test_speech_check_uses_the_pass_mark() -> None:
    game = REGISTRY["speech-practice"]

    assert game.check({"text": "rabbit"}, SpeechAnswer(transcript="rabbit")).is_correct
    assert not game.check({"text": "rabbit"}, SpeechAnswer(transcript="carrot")).is_correct
