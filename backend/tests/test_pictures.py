"""Pictures on answer options: the all-or-none rule, and the emoji kept in the content bank."""

import random
import unicodedata

import pytest
from pydantic import ValidationError

from app.modules.games.content import ContentBank, load_bank
from app.modules.games.definitions import REGISTRY, RoundContext
from app.modules.games.pictures import with_pictures

PICTURES = {"cat": "🐱", "hat": "🎩", "dog": "🐶"}


def options(*ids: str) -> list[dict[str, str]]:
    return [{"id": i, "label": i} for i in ids]


# ---------------------------------------------------------------- the rule


def test_every_option_gets_its_picture_when_all_have_one() -> None:
    assert with_pictures(options("cat", "hat"), PICTURES) == [
        {"id": "cat", "label": "cat", "emoji": "🐱"},
        {"id": "hat", "label": "hat", "emoji": "🎩"},
    ]


def test_no_option_gets_a_picture_when_one_is_missing() -> None:
    assert with_pictures(options("cat", "bun"), PICTURES) == options("cat", "bun")


def test_no_option_gets_a_picture_when_two_share_one() -> None:
    shared = PICTURES | {"kitten": "🐱"}

    assert with_pictures(options("cat", "kitten", "hat"), shared) == options("cat", "kitten", "hat")


def test_a_picture_already_on_an_option_is_never_left_on_its_own() -> None:
    given = [{"id": "cat", "label": "cat", "emoji": "🐱"}, {"id": "bun", "label": "bun"}]

    assert with_pictures(given, PICTURES) == options("cat", "bun")
    assert with_pictures([], PICTURES) == []  # speech games


@pytest.mark.parametrize("seed", range(40))
@pytest.mark.parametrize("slug", sorted(REGISTRY))
def test_every_game_at_every_level_shows_pictures_on_all_options_or_none(
    slug: str, seed: int
) -> None:
    bank = load_bank()
    definition = REGISTRY[slug]
    pictures = bank.pictures_for(definition.option_kind)
    for level in range(1, 10):
        context = RoundContext(
            level=level, rng=random.Random(seed), bank=bank, with_noise=definition.always_noise
        )
        for spec in definition.build_rounds(context):
            shown = with_pictures(spec.prompt["options"], pictures)
            emojis = [o.get("emoji") for o in shown]
            if emojis:
                assert all(emojis) or not any(emojis), (slug, level, shown)
                if all(emojis):
                    assert len(set(emojis)) == len(emojis)


def test_sound_detective_always_has_pictures_and_word_games_use_the_word_pictures() -> None:
    bank = load_bank()
    sounds = bank.pictures_for("sounds")

    assert set(sounds) == {s.id for s in bank.sounds}
    assert len(set(sounds.values())) == len(sounds)  # no two sounds look the same
    assert REGISTRY["sound-detective"].option_kind == "sounds"
    assert {d.option_kind for s, d in REGISTRY.items() if s != "sound-detective"} == {"words"}
    assert bank.pictures_for("words")["hat"] == "🎩"
    assert "kitten" not in bank.pictures_for("words")  # 🐱 is "cat"


def test_the_bank_refuses_pictures_for_words_it_does_not_have() -> None:
    data = load_bank().model_dump() | {"pictures": {"hat": "🎩", "hatt": "🎩"}}

    with pytest.raises(ValidationError, match="hatt"):
        ContentBank.model_validate(data)


# ---------------------------------------------------------------- no emoji from 2020 or later

# Emoji code points added in Unicode 13.0 (2020), 14.0 (2021) and 15.0 (2022), from the Unicode
# emoji charts. Anything newer than 15.0 isn't in Python 3.12's Unicode data, so it is refused too.
ADDED_SINCE_2020 = frozenset(
    {
        0x26A7,  # transgender symbol: an old character, an emoji only since 13.0
        *range(0x1F6D6, 0x1F6D8),
        *range(0x1F6DC, 0x1F6E0),
        *range(0x1F6FB, 0x1F6FD),
        0x1F7F0,
        0x1F90C,
        0x1F972,
        *range(0x1F977, 0x1F97A),
        *range(0x1F9A3, 0x1F9A5),
        *range(0x1F9AB, 0x1F9AE),
        *range(0x1F9CB, 0x1F9CD),
    }
)
# Symbols and Pictographs Extended-A: only these existed before 2020; the rest is 13.0 or later.
EXTENDED_A = range(0x1FA70, 0x1FB00)
EXTENDED_A_BEFORE_2020 = frozenset(
    {
        *range(0x1FA70, 0x1FA74),
        *range(0x1FA78, 0x1FA7B),
        *range(0x1FA80, 0x1FA83),
        *range(0x1FA90, 0x1FA96),
    }
)
VARIATION_SELECTOR, KEYCAP, ZERO_WIDTH_JOINER = 0xFE0F, 0x20E3, 0x200D


def too_new(emoji: str) -> str | None:
    """Why this emoji may not show on a device from before 2020, or None if it will."""
    points = [ord(c) for c in emoji]
    if ZERO_WIDTH_JOINER in points:
        # Joined sequences (e.g. ❤️‍🔥) are how many newer emoji are made from older characters.
        return "a joined sequence"
    for point in points:
        if point in (VARIATION_SELECTOR, KEYCAP):
            continue
        if unicodedata.name(chr(point), None) is None:
            return f"U+{point:04X} is newer than Unicode {unicodedata.unidata_version}"
        if point in ADDED_SINCE_2020 or (
            point in EXTENDED_A and point not in EXTENDED_A_BEFORE_2020
        ):
            return f"U+{point:04X} ({unicodedata.name(chr(point))}) is from 2020 or later"
    return None


@pytest.mark.parametrize(
    "emoji",
    ["🪨", "🪵", "🪟", "🫛", "🪭", "🛖", "🦫", "🧋", "🛝", "❤️‍🔥", "🐻‍❄️", "\U0001fac8"],
)
def test_the_check_refuses_emoji_from_2020_on(emoji: str) -> None:
    assert too_new(emoji) is not None


@pytest.mark.parametrize("emoji", ["🎩", "3️⃣", "🌬️", "☂️", "🦖", "🧦", "🦢", "🪀", "🪑", "🛺"])
def test_the_check_accepts_emoji_from_before_2020(emoji: str) -> None:
    assert too_new(emoji) is None


def test_the_bank_has_no_emoji_from_2020_or_later() -> None:
    bank = load_bank()
    emojis = {f"sound {s.id}": s.emoji for s in bank.sounds if s.emoji} | {
        f"word {word}": emoji for word, emoji in bank.pictures.items()
    }

    refused = {where: (emoji, too_new(emoji)) for where, emoji in emojis.items() if too_new(emoji)}

    assert refused == {}
    assert len(emojis) == 24 + 56  # every sound, and the approved words
