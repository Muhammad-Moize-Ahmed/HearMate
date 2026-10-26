/**
 * Labels for the child profile options. The keys come from the backend (children/options.py) via
 * the generated types, so a missing or misspelt key is a type error.
 */
import type { components } from '../../api/schema';
import { AVATAR_LABELS } from '../../lib/avatars';

type S = components['schemas'];
export type Option<V extends string> = { value: V; label: string; emoji?: string };

function options<V extends string>(labels: Record<V, string | [string, string]>): Option<V>[] {
  return (Object.entries(labels) as [V, string | [string, string]][]).map(([value, label]) =>
    Array.isArray(label) ? { value, emoji: label[0], label: label[1] } : { value, label },
  );
}

/** The keys of a label map, as a non-empty tuple (what `z.enum` needs). */
export function keysOf<V extends string>(labels: Record<V, unknown>): [V, ...V[]] {
  return Object.keys(labels) as [V, ...V[]];
}

export { AVATAR_LABELS };
export const AVATARS = options(AVATAR_LABELS);

export const GENDER_LABELS: Record<S['Gender'], string> = {
  female: 'Girl',
  male: 'Boy',
  other: 'Other',
  undisclosed: 'Prefer not to say',
};
export const GENDERS = options(GENDER_LABELS);

export const HEARING_LABELS: Record<S['HearingDifficulty'], string> = {
  noisy_environments: 'Following talk in noisy places',
  not_facing_speaker: "Understanding when they can't see the speaker",
  asks_for_repetition: 'Often asks "what?"',
  rapid_speech: 'Keeping up with fast speech',
  sound_discrimination: 'Telling similar sounds apart',
  rhyming_phonics: 'Rhyming and phonics',
  multi_step_instructions: 'Following instructions with several steps',
};
export const HEARING_DIFFICULTIES = options(HEARING_LABELS);

export const SPEECH_LABELS: Record<S['SpeechChallenge'], string> = {
  pronunciation: 'Saying some sounds clearly',
  limited_vocabulary: 'Knowing enough words',
  grammar: 'Grammar',
  volume_control: 'Speaking too quietly or loudly',
  monotone: 'A flat, monotone voice',
  word_finding: 'Finding the right word',
  social_communication: 'Conversations and taking turns',
};
export const SPEECH_CHALLENGES = options(SPEECH_LABELS);

export const FOCUS_LABELS: Record<S['FocusArea'], string> = {
  listening_skills: 'Listening',
  speech_clarity: 'Clear speech',
  pronunciation: 'Pronunciation',
  vocabulary: 'Vocabulary',
  conversation: 'Conversation',
  attention_span: 'Attention',
  speaking_confidence: 'Confidence speaking',
};
export const FOCUS_AREAS = options(FOCUS_LABELS);

export const INTEREST_LABELS: Record<S['Interest'], [string, string]> = {
  animals: ['🐾', 'Animals'],
  music: ['🎵', 'Music'],
  art: ['🎨', 'Art'],
  sports: ['⚽', 'Sports'],
  science: ['🔬', 'Science'],
  space: ['🪐', 'Space'],
  dinosaurs: ['🦕', 'Dinosaurs'],
  cars: ['🚗', 'Cars'],
  princesses: ['👑', 'Princesses'],
  superheroes: ['🦸', 'Superheroes'],
  cooking: ['🍳', 'Cooking'],
  nature: ['🌳', 'Nature'],
  books: ['📚', 'Books'],
  games: ['🎲', 'Games'],
};
export const INTERESTS = options(INTEREST_LABELS);

export const LEARNING_STYLE_LABELS: Record<S['LearningStyle'], string> = {
  visual: 'Seeing (pictures and videos)',
  auditory: 'Hearing (talking and listening)',
  kinesthetic: 'Doing (hands-on)',
  mixed: 'A mix',
};
export const LEARNING_STYLES = options(LEARNING_STYLE_LABELS);

export const ENVIRONMENT_LABELS: Record<S['LearningEnvironment'], string> = {
  home: 'At home',
  school: 'At school',
  clinic: 'At a clinic',
  mixed: 'A mix',
};
export const ENVIRONMENTS = options(ENVIRONMENT_LABELS);

export const ATTENTION_LABELS: Record<S['AttentionSpan'], string> = {
  short: 'Short (a few minutes)',
  medium: 'Medium (about 10 minutes)',
  long: 'Long (15 minutes or more)',
};
export const ATTENTION_SPANS = options(ATTENTION_LABELS);

export const SESSION_LENGTHS = [5, 10, 15, 20, 30] as const;

/** A label for a stored option key; unknown keys (newer than this app) are shown as-is. */
export function labelFor(labels: Record<string, string | [string, string]>, key: string): string {
  const label = labels[key];
  if (label === undefined) return key.replaceAll('_', ' ');
  return Array.isArray(label) ? `${label[0]} ${label[1]}` : label;
}
