/**
 * Turns the daily trend from the API into what the charts draw. Pure functions, so they are
 * tested on their own; the charts only lay out what comes out of here.
 */
import type { components } from '../../api/schema';
import { formatDateSpan, formatShortDate } from '../../lib/dates';
import { starsFor } from '../play/meta';

type S = components['schemas'];
export type Day = S['DayOut'];
export type SkillCategory = S['SkillCategory'];

/** Skills in a fixed order: each keeps its colour and marker whatever else is shown. */
export const SKILLS: { value: SkillCategory; label: string }[] = [
  { value: 'listening', label: 'Listening' },
  { value: 'memory', label: 'Memory' },
  { value: 'speech', label: 'Speaking' },
];

export function skillLabel(category: SkillCategory): string {
  return SKILLS.find((s) => s.value === category)?.label ?? category;
}

/** A point on the x axis: one day, or one week of a longer period. */
export type Bucket = { start: string; end: string; label: string; days: Day[] };

/** Daily points up to a month; weekly beyond that, so a phone-width chart stays readable. */
export function bucketDays(days: Day[]): Bucket[] {
  const size = days.length > 31 ? 7 : 1;
  const buckets: Bucket[] = [];
  // Weeks are counted back from the last day, so the newest point is always a full week.
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    const start = chunk[0]!.date;
    const last = chunk[chunk.length - 1]!.date;
    buckets.unshift({
      start,
      end: last,
      label: size === 1 ? formatShortDate(start) : formatDateSpan(start, last),
      days: chunk,
    });
  }
  return buckets;
}

export type Series = { key: string; label: string; values: (number | null)[] };

/**
 * Average score (0-100) per bucket, by skill or by game. Each game-day is weighted by its
 * sessions; a bucket without play is null (a gap, not a zero). Only series with any play appear.
 */
export function scoreSeries(
  buckets: Bucket[],
  by: 'skill' | 'game',
  names: { key: string; label: string }[],
): Series[] {
  const series = names.map(({ key, label }) => ({
    key,
    label,
    values: buckets.map((bucket) => {
      let total = 0;
      let sessions = 0;
      for (const day of bucket.days) {
        for (const game of day.games) {
          if ((by === 'skill' ? game.category : game.game) !== key) continue;
          total += game.average_accuracy * game.sessions;
          sessions += game.sessions;
        }
      }
      return sessions > 0 ? Math.round((total / sessions) * 10) / 10 : null;
    }),
  }));
  return series.filter((s) => s.values.some((v) => v !== null));
}

/** The level in each skill at the end of each bucket. */
export function levelSeries(buckets: Bucket[]): Series[] {
  return SKILLS.map(({ value, label }) => ({
    key: value,
    label,
    values: buckets.map((bucket) => {
      const last = bucket.days[bucket.days.length - 1];
      return last?.levels.find((l) => l.category === value)?.level ?? null;
    }),
  }));
}

export type Activity = { label: string; sessions: number; minutes: number };

export function activityPerBucket(buckets: Bucket[]): Activity[] {
  return buckets.map((bucket) => ({
    label: bucket.label,
    sessions: bucket.days.reduce((sum, d) => sum + d.sessions, 0),
    minutes: bucket.days.reduce((sum, d) => sum + d.minutes, 0),
  }));
}

export type Run = { start: string; end: string; length: number };

/** Runs of days in a row with at least one game, oldest first. */
export function streakRuns(days: Day[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const day of days) {
    if (day.sessions > 0) {
      if (current) {
        current.end = day.date;
        current.length += 1;
      } else {
        current = { start: day.date, end: day.date, length: 1 };
        runs.push(current);
      }
    } else {
      current = null;
    }
  }
  return runs;
}

export function longestRun(runs: Run[]): Run | null {
  return runs.reduce<Run | null>(
    (best, run) => (!best || run.length > best.length ? run : best),
    null,
  );
}

/** Stars a child has collected: the best result in each game, 0-3 stars each. */
export function totalStars(bests: { best_accuracy: number | null }[]): number {
  return bests.reduce(
    (sum, b) => sum + (b.best_accuracy === null ? 0 : starsFor(b.best_accuracy)),
    0,
  );
}

/** A sentence for screen readers: where each series starts and ends, e.g. "Listening 40% to 80%". */
export function describeSeries(series: Series[], format: (value: number) => string): string {
  return series
    .map((s) => {
      const values = s.values.filter((v): v is number => v !== null);
      if (values.length === 0) return `${s.label}: no games`;
      const first = values[0]!;
      const last = values[values.length - 1]!;
      return values.length === 1 || first === last
        ? `${s.label} ${format(last)}`
        : `${s.label} ${format(first)} to ${format(last)}`;
    })
    .join('; ');
}
