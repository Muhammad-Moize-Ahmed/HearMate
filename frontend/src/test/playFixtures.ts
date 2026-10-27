import type { components } from '../api/schema';
import { CHILD, mockApi, tokenFor } from './mockApi';

type S = components['schemas'];

export const SESSION_ID = '66666666-6666-6666-6666-666666666666';
export const SESSION = `/api/sessions/${SESSION_ID}`;

export const GAMES: S['GameOut'][] = [
  game('sound-detective', 'Sound Detective', 'listening', { supports_noise: true }),
  game('similar-sounds', 'Similar Sounds', 'listening', { supports_noise: true }),
  game('word-sequence', 'Word Sequence', 'memory'),
  game('listening-in-noise', 'Listening in Noise', 'listening', { always_noise: true }),
  game('speech-practice', 'Speech Practice', 'speech', { requires_microphone: true }),
];

function game(
  slug: string,
  title: string,
  category: S['SkillCategory'],
  flags: Partial<S['GameOut']> = {},
): S['GameOut'] {
  return {
    slug,
    title,
    category,
    description: `${title} description.`,
    icon: 'ear',
    rounds_per_session: 2,
    requires_microphone: false,
    supports_noise: false,
    always_noise: false,
    ...flags,
  };
}

export function prompt(overrides: Partial<S['PromptOut']> = {}): S['PromptOut'] {
  return {
    instruction: 'Which sound did you hear?',
    stimulus: { type: 'sound', audio_url: `${SESSION}/rounds/0/stimulus` },
    options: [
      { id: 'dog', label: 'Dog barking' },
      { id: 'cat', label: 'Cat meowing' },
    ],
    noise: null,
    display_text: null,
    ...overrides,
  };
}

export function session(
  slug: string,
  prompts: S['PromptOut'][],
  overrides: Partial<S['SessionOut']> = {},
): S['SessionOut'] {
  const found = GAMES.find((g) => g.slug === slug)!;
  return {
    id: SESSION_ID,
    child_id: CHILD.id,
    game: { slug, title: found.title, category: found.category },
    status: 'in_progress',
    difficulty: 'easy',
    level: 2,
    with_noise: false,
    started_at: '2026-10-27T10:00:00Z',
    completed_at: null,
    rounds: prompts.map((p, index) => ({
      index,
      prompt: p,
      answered: false,
      is_correct: null,
      given_answer: null,
      correct_answer: null,
    })),
    result: null,
    ...overrides,
  };
}

export function answerOut(overrides: Partial<S['AnswerOut']> = {}): S['AnswerOut'] {
  return {
    index: 0,
    is_correct: true,
    score: 100,
    correct_answer: { choice: 'dog' },
    feedback: {},
    rounds_remaining: 1,
    ...overrides,
  };
}

export function completed(base: S['SessionOut'], result: Partial<S['SessionResultOut']> = {}) {
  return {
    ...base,
    status: 'completed' as const,
    completed_at: '2026-10-27T10:05:00Z',
    result: {
      total_rounds: base.rounds.length,
      correct_rounds: base.rounds.length,
      accuracy: 100,
      points: 30,
      duration_seconds: 60,
      level_before: 2,
      level_after: 3,
      level_reason: 'Two strong sessions in a row',
      streak_days: 4,
      new_achievements: [],
      goals_achieved: [],
      ...result,
    },
  };
}

type Routes = Parameters<typeof mockApi>[0];

/** A signed-in child (Ali) with the five games, a level per skill, and speech ready. */
export function mockChildApi(routes: Routes = {}) {
  return mockApi({
    'POST /api/auth/refresh': { body: tokenFor(CHILD) },
    'GET /api/games': { body: GAMES },
    [`GET /api/children/${CHILD.id}/levels`]: {
      body: [
        { category: 'listening', level: 2, difficulty: 'easy' },
        { category: 'speech', level: 5, difficulty: 'medium' },
        { category: 'memory', level: 7, difficulty: 'hard' },
      ],
    },
    'GET /api/speech/status': {
      body: {
        stt: { provider: 'whisper', available: true },
        tts: { voice: 'piper', available: true },
      },
    },
    'GET /api/family/progress': {
      body: [
        {
          child_id: CHILD.id,
          display_name: 'Ali',
          avatar: 'fox',
          this_week: { sessions: 3, points: 90, minutes: 12 },
          current_streak: 4,
          achievements_unlocked: 1,
        },
      ],
    },
    [`GET ${SESSION}/rounds/0/stimulus`]: { body: 'RIFF' },
    [`GET ${SESSION}/rounds/1/stimulus`]: { body: 'RIFF' },
    [`POST ${SESSION}/abandon`]: { body: {} },
    ...routes,
  });
}
