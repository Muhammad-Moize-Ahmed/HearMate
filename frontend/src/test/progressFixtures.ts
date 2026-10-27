import type { components } from '../api/schema';
import { addDays } from '../lib/dates';
import { CHILD_ID, mockParentApi } from './fixtures';
import { GAMES } from './playFixtures';

type S = components['schemas'];
type Routes = Parameters<typeof mockParentApi>[0];

const LEVELS = { listening: 1, memory: 1, speech: 1 };

/** One day of the trend; games played that day decide its totals unless given. */
export function dayOut(
  date: string,
  games: S['GameDayOut'][] = [],
  levels: Partial<typeof LEVELS> = {},
): S['DayOut'] {
  const sessions = games.reduce((sum, g) => sum + g.sessions, 0);
  const accuracy = sessions
    ? games.reduce((sum, g) => sum + g.average_accuracy * g.sessions, 0) / sessions
    : null;
  return {
    date,
    sessions,
    points: sessions * 30,
    minutes: sessions * 5,
    average_accuracy: accuracy,
    games,
    levels: Object.entries({ ...LEVELS, ...levels }).map(([category, level]) => ({
      category: category as S['SkillCategory'],
      level,
    })),
  };
}

export function played(game: string, average_accuracy: number, sessions = 1): S['GameDayOut'] {
  const category = GAMES.find((g) => g.slug === game)?.category ?? 'listening';
  return { game, category, sessions, average_accuracy };
}

/** `count` days ending on `end`, with play on the days given (by date). */
export function trend(
  end: string,
  count: number,
  plays: Record<string, S['GameDayOut'][]> = {},
  levels: (date: string) => Partial<typeof LEVELS> = () => ({}),
): S['DayOut'][] {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(end, i - count + 1);
    return dayOut(date, plays[date], levels(date));
  });
}

export function summaryOut(
  overrides: Partial<S['ProgressSummaryOut']> = {},
): S['ProgressSummaryOut'] {
  return {
    child_id: CHILD_ID,
    period: { start: '2026-09-28', end: '2026-10-27', days: 30, timezone: 'Asia/Karachi' },
    all_time: { sessions: 12, points: 360, minutes: 60 },
    in_period: { sessions: 5, points: 150, minutes: 25 },
    current_streak: 2,
    longest_streak: 6,
    achievements_unlocked: 1,
    skills: [
      {
        category: 'listening',
        level: 3,
        difficulty: 'easy',
        sessions: 4,
        average_accuracy: 72.5,
        accuracy_change: 15,
        minutes: 20,
      },
      {
        category: 'speech',
        level: 1,
        difficulty: 'easy',
        sessions: 0,
        average_accuracy: null,
        accuracy_change: null,
        minutes: 0,
      },
      {
        category: 'memory',
        level: 2,
        difficulty: 'easy',
        sessions: 1,
        average_accuracy: 50,
        accuracy_change: null,
        minutes: 5,
      },
    ],
    recent_level_changes: [],
    active_goals: [
      {
        id: '55555555-5555-5555-5555-555555555555',
        title: 'Listening week',
        category: 'listening',
        current_value: 3,
        target_value: 5,
        due_date: null,
        status: 'active',
      },
    ],
    ...overrides,
  };
}

export function reportOut(overrides: Partial<S['ChildReportOut']> = {}): S['ChildReportOut'] {
  return {
    generated_at: '2026-10-27T09:00:00Z',
    summary: summaryOut(),
    games: [
      {
        slug: 'similar-sounds',
        title: 'Similar Sounds',
        category: 'listening',
        sessions: 3,
        average_accuracy: 66.7,
        best_accuracy: 90,
        average_response_ms: 1850,
      },
    ],
    listening_in_noise: [{ band: 'loud', snr_range_db: 'below 8 dB', rounds: 8, accuracy: 37.5 }],
    speech: { attempts: 6, average_score: 71.2, sounds_to_practise: [{ sound: 'TH', misses: 3 }] },
    hardest_contrasts: [{ contrast: 'p/b', rounds: 4, accuracy: 25 }],
    level_changes: [
      {
        category: 'listening',
        old_level: 2,
        new_level: 3,
        reason: 'Scored 90% or more',
        changed_at: '2026-10-20T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

export const ACHIEVEMENTS: S['AchievementOut'][] = [
  {
    code: 'first_session',
    title: 'First steps',
    description: 'Finish your first game',
    icon: 'sparkles',
    unlocked_at: '2026-10-25T08:00:00Z',
  },
  {
    code: 'streak_7',
    title: 'Week warrior',
    description: 'Play 7 days in a row',
    icon: 'flame',
    unlocked_at: null,
  },
];

const base = `/api/children/${CHILD_ID}`;

/** A parent with Ali, whose progress has some play in the last month. */
export function mockProgressApi(routes: Routes = {}) {
  return mockParentApi({
    'GET /api/games': { body: GAMES },
    [`GET ${base}/progress`]: { body: summaryOut() },
    [`GET ${base}/progress/trend`]: {
      body: trend('2026-10-27', 30, {
        '2026-10-20': [played('similar-sounds', 60, 2)],
        '2026-10-26': [played('similar-sounds', 80), played('word-sequence', 50)],
        '2026-10-27': [played('similar-sounds', 90)],
      }),
    },
    [`GET ${base}/report`]: { body: reportOut() },
    [`GET ${base}/achievements`]: { body: ACHIEVEMENTS },
    ...routes,
  });
}
