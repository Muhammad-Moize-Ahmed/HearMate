"""The game registry: the frontend and the database refer to games only by `slug`."""

from .base import GameDefinition, RoundCheck, RoundContext, RoundSpec
from .listening_in_noise import ListeningInNoise
from .similar_sounds import SimilarSounds
from .sound_detective import SoundDetective
from .speech_practice import SpeechPractice
from .word_sequence import WordSequence

REGISTRY: dict[str, GameDefinition] = {
    game.slug: game
    for game in (
        SoundDetective(),
        SimilarSounds(),
        WordSequence(),
        ListeningInNoise(),
        SpeechPractice(),
    )
}

__all__ = ["REGISTRY", "GameDefinition", "RoundCheck", "RoundContext", "RoundSpec"]
