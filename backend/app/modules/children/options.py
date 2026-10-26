"""Allowed values for the child profile form.

Stored as plain text in the database, validated here, so adding an option needs no migration.
The frontend maps these keys to labels and icons.
"""

from enum import StrEnum


class HearingDifficulty(StrEnum):
    NOISY_ENVIRONMENTS = "noisy_environments"  # following conversations in noise
    NOT_FACING_SPEAKER = "not_facing_speaker"  # understanding speech without seeing the speaker
    ASKS_FOR_REPETITION = "asks_for_repetition"
    RAPID_SPEECH = "rapid_speech"
    SOUND_DISCRIMINATION = "sound_discrimination"
    RHYMING_PHONICS = "rhyming_phonics"
    MULTI_STEP_INSTRUCTIONS = "multi_step_instructions"


class SpeechChallenge(StrEnum):
    PRONUNCIATION = "pronunciation"
    LIMITED_VOCABULARY = "limited_vocabulary"
    GRAMMAR = "grammar"
    VOLUME_CONTROL = "volume_control"  # speaking too quietly or loudly
    MONOTONE = "monotone"
    WORD_FINDING = "word_finding"
    SOCIAL_COMMUNICATION = "social_communication"


class FocusArea(StrEnum):
    SPEECH_CLARITY = "speech_clarity"
    LISTENING_SKILLS = "listening_skills"
    VOCABULARY = "vocabulary"
    PRONUNCIATION = "pronunciation"
    CONVERSATION = "conversation"
    ATTENTION_SPAN = "attention_span"
    SPEAKING_CONFIDENCE = "speaking_confidence"


class Interest(StrEnum):
    ANIMALS = "animals"
    MUSIC = "music"
    ART = "art"
    SPORTS = "sports"
    SCIENCE = "science"
    SPACE = "space"
    DINOSAURS = "dinosaurs"
    CARS = "cars"
    PRINCESSES = "princesses"
    SUPERHEROES = "superheroes"
    COOKING = "cooking"
    NATURE = "nature"
    BOOKS = "books"
    GAMES = "games"


class LearningStyle(StrEnum):
    VISUAL = "visual"
    AUDITORY = "auditory"
    KINESTHETIC = "kinesthetic"
    MIXED = "mixed"


class LearningEnvironment(StrEnum):
    HOME = "home"
    SCHOOL = "school"
    CLINIC = "clinic"
    MIXED = "mixed"


class AttentionSpan(StrEnum):
    SHORT = "short"
    MEDIUM = "medium"
    LONG = "long"


class Avatar(StrEnum):
    BEAR = "bear"
    CAT = "cat"
    DOG = "dog"
    FOX = "fox"
    LION = "lion"
    OWL = "owl"
    PANDA = "panda"
    RABBIT = "rabbit"
    ROBOT = "robot"
    ROCKET = "rocket"


SESSION_LENGTHS_MINUTES = (5, 10, 15, 20, 30)
