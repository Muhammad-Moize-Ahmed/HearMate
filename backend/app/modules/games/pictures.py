"""Pictures on answer options: every option in a round shows one, or none does.

A picture on only some options (or the same picture on two) is a visual hint that can bias a
child's answer, so this is the only place pictures are added. The session service runs it on
every round's options, for every game, before the round is stored. The pictures themselves live
in the content bank (`ContentBank.pictures_for`).
"""

from collections.abc import Mapping
from typing import Any


def with_pictures(
    options: list[dict[str, Any]], pictures: Mapping[str, str]
) -> list[dict[str, Any]]:
    """The options, each with its `emoji`, if every one has a picture and no two share one;
    otherwise the options without any."""
    emojis = [pictures.get(option["id"]) for option in options]
    plain = [{k: v for k, v in option.items() if k != "emoji"} for option in options]
    if not options or None in emojis or len(set(emojis)) != len(emojis):
        return plain
    return [option | {"emoji": emoji} for option, emoji in zip(plain, emojis, strict=True)]
