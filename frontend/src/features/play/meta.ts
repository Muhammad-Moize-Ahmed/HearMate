/** How games, sounds and results look to a child. Keys come from the backend's game catalogue. */
import type { Game, Prompt } from './api';

type Look = { emoji: string; tile: string };

const GAMES: Record<string, Look> = {
  'sound-detective': { emoji: '🔍', tile: 'bg-sun-200' },
  'similar-sounds': { emoji: '👂', tile: 'bg-mint-200' },
  'word-sequence': { emoji: '🧠', tile: 'bg-coral-200' },
  'listening-in-noise': { emoji: '🌧️', tile: 'bg-sky-soft' },
  'speech-practice': { emoji: '🎤', tile: 'bg-brand-200' },
};

/** A new game added on the server still gets a tile, chosen from its icon name. */
const ICONS: Record<string, string> = { ear: '👂', waves: '〰️', mic: '🎤', volume: '🔊' };

export function gameLook(game: Pick<Game, 'slug' | 'icon'>): Look {
  return GAMES[game.slug] ?? { emoji: ICONS[game.icon] ?? '🎮', tile: 'bg-brand-100' };
}

const SOUNDS: Record<string, string> = {
  dog: '🐶',
  cat: '🐱',
  cow: '🐮',
  duck: '🦆',
  lion: '🦁',
  frog: '🐸',
  bird: '🐦',
  car_horn: '🚗',
  train: '🚆',
  airplane: '✈️',
  bicycle_bell: '🚲',
  ambulance: '🚑',
  doorbell: '🚪',
  phone: '📱',
  clock: '⏰',
  vacuum: '🧹',
  tap: '🚰',
  rain: '🌧️',
  thunder: '⛈️',
  wind: '💨',
  drum: '🥁',
  piano: '🎹',
  guitar: '🎸',
  bell: '🔔',
};

/** A picture for a Sound Detective option (by sound id); none for word options. */
export function soundEmoji(id: string): string | undefined {
  return SOUNDS[id];
}

/** How a round is answered, from its prompt: tap one, tap several in order, or speak. */
export type AnswerKind = 'choice' | 'sequence' | 'speech';

export function answerKind(slug: string, prompt: Prompt): AnswerKind {
  if (slug === 'word-sequence' || prompt.answer_length != null) return 'sequence';
  if (prompt.options.length === 0) return 'speech';
  return 'choice';
}

export const TIER_LABEL: Record<string, { emoji: string; label: string }> = {
  easy: { emoji: '🌱', label: 'Easy' },
  medium: { emoji: '🌿', label: 'Medium' },
  hard: { emoji: '🌳', label: 'Hard' },
};

/** 0-3 stars for a session's accuracy (0-100). */
export function starsFor(accuracy: number): 0 | 1 | 2 | 3 {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  if (accuracy >= 40) return 1;
  return 0;
}

export const CHEER: Record<0 | 1 | 2 | 3, string> = {
  3: 'Amazing!',
  2: 'Great job!',
  1: 'Good try!',
  0: 'Keep practising!',
};

const ACHIEVEMENT_ICONS: Record<string, string> = {
  sparkles: '✨',
  medal: '🏅',
  trophy: '🏆',
  star: '⭐',
  'arrow-up': '⬆️',
  mountain: '⛰️',
  flame: '🔥',
  compass: '🧭',
  gem: '💎',
  headphones: '🎧',
  mic: '🎤',
};

export function achievementEmoji(icon: string): string {
  return ACHIEVEMENT_ICONS[icon] ?? '🏅';
}

/** ARPAbet sounds (from speech scoring) as letters a child knows. */
const SOUND_LETTERS: Record<string, string> = {
  TH: 'th',
  DH: 'th',
  SH: 'sh',
  ZH: 's',
  CH: 'ch',
  JH: 'j',
  NG: 'ng',
  HH: 'h',
  Y: 'y',
  W: 'w',
  R: 'r',
  L: 'l',
};

export function soundLetters(arpabet: string): string {
  const base = arpabet.replace(/\d/g, '');
  return SOUND_LETTERS[base] ?? base.toLowerCase();
}
