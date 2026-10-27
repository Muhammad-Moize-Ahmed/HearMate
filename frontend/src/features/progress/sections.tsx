/** Progress sections shared by the parent's progress page and the printable report. */
import { useState } from 'react';
import { Link } from 'react-router';

import { ProgressBar } from '../../components/ui/ProgressBar';
import { formatDate, formatDateSpan, formatDay } from '../../lib/dates';
import { useChildArea } from '../children/paths';
import type { Game } from '../play/api';
import { achievementEmoji } from '../play/meta';
import type { Achievement, Summary } from './api';
import { BarChart } from './charts/BarChart';
import { ChartCard } from './charts/ChartCard';
import { LineChart } from './charts/LineChart';
import { styleAt } from './charts/styles';
import {
  activityPerBucket,
  bucketDays,
  describeSeries,
  levelSeries,
  longestRun,
  scoreSeries,
  SKILLS,
  streakRuns,
  type Day,
} from './transform';

const percent = (value: number) => `${Math.round(value)}%`;
const SCORE_TICKS = [0, 25, 50, 75, 100];
const LEVEL_TICKS = [1, 3, 5, 7, 9];
const NO_GAMES = 'No games in this period yet. Pick a longer period, or check back after a game.';

function pointNote(days: Day[]) {
  return days.length > 31 ? 'Each point is one week.' : 'Each point is one day.';
}

export function ScoresChart({ days, games }: { days: Day[]; games: Game[] }) {
  const [by, setBy] = useState<'skill' | 'game'>('skill');
  const buckets = bucketDays(days);
  const names =
    by === 'skill'
      ? SKILLS.map((s) => ({ key: s.value, label: s.label }))
      : games.map((g) => ({ key: g.slug, label: g.title }));
  // Styles follow the skill or game itself, so a series looks the same whatever else is shown.
  const series = scoreSeries(buckets, by, names).map((s) => ({
    ...s,
    style: styleAt(names.findIndex((n) => n.key === s.key)),
  }));
  const labels = buckets.map((b) => b.label);

  return (
    <ChartCard
      title="Scores over time"
      note={`Average score in each ${by === 'skill' ? 'skill' : 'game'}. ${pointNote(days)}`}
      legend={series}
      empty={series.length === 0 ? NO_GAMES : undefined}
      table={{
        columns: ['When', ...series.map((s) => s.label)],
        rows: buckets.map((b, i) => ({
          label: b.label,
          cells: series.map((s) => (s.values[i] == null ? '–' : percent(s.values[i]!))),
        })),
      }}
    >
      <div role="group" aria-label="Show scores by" className="mb-2 flex gap-2 print:hidden">
        {(['skill', 'game'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={by === option}
            onClick={() => setBy(option)}
            className="min-h-11 rounded-full px-4 text-sm font-bold ring-2 ring-brand-200 aria-pressed:bg-brand-100 aria-pressed:ring-brand-500"
          >
            By {option}
          </button>
        ))}
      </div>
      <LineChart
        labels={labels}
        series={series}
        domain={[0, 100]}
        yTicks={SCORE_TICKS}
        format={percent}
        summary={`Average score by ${by}: ${describeSeries(series, percent)}.`}
      />
    </ChartCard>
  );
}

export function LevelsChart({ days }: { days: Day[] }) {
  const buckets = bucketDays(days);
  const series = levelSeries(buckets).map((s, i) => ({ ...s, style: styleAt(i) }));
  const level = (value: number) => `Level ${value}`;
  return (
    <ChartCard
      title="Levels"
      note={`The level in each skill (1 to 9). Games get harder as the level goes up. ${pointNote(days)}`}
      legend={series}
      empty={days.length === 0 ? NO_GAMES : undefined}
      table={{
        columns: ['When', ...series.map((s) => s.label)],
        rows: buckets.map((b, i) => ({
          label: b.label,
          cells: series.map((s) => String(s.values[i] ?? '–')),
        })),
      }}
    >
      <LineChart
        labels={buckets.map((b) => b.label)}
        series={series}
        domain={[1, 9]}
        yTicks={LEVEL_TICKS}
        format={(v) => String(v)}
        step
        summary={`Level by skill: ${describeSeries(series, level)}.`}
      />
    </ChartCard>
  );
}

export function ActivityChart({ days }: { days: Day[] }) {
  const buckets = bucketDays(days);
  const activity = activityPerBucket(buckets);
  const total = activity.reduce((sum, a) => sum + a.sessions, 0);
  const weekly = days.length > 31;
  return (
    <ChartCard
      title={weekly ? 'Games per week' : 'Games per day'}
      note={`${total} ${total === 1 ? 'game' : 'games'} in this period.`}
      empty={total === 0 ? NO_GAMES : undefined}
      table={{
        columns: ['When', 'Games', 'Minutes'],
        rows: activity.map((a) => ({
          label: a.label,
          cells: [String(a.sessions), String(a.minutes)],
        })),
      }}
    >
      <BarChart
        labels={activity.map((a) => a.label)}
        values={activity.map((a) => a.sessions)}
        format={(v) => `${v} ${v === 1 ? 'game' : 'games'}`}
        summary={`Games played ${weekly ? 'each week' : 'each day'}: ${total} in total.`}
      />
    </ChartCard>
  );
}

/** Which days had play, as a strip of squares: filled with a tick when played, outlined if not. */
export function StreakHistory({ days, summary }: { days: Day[]; summary: Summary }) {
  const runs = streakRuns(days);
  const best = longestRun(runs);
  const played = days.filter((d) => d.sessions > 0).length;
  const small = days.length > 31;
  const description =
    `Played on ${played} of ${days.length} days.` +
    (best
      ? ` Longest run in this period: ${best.length} ${best.length === 1 ? 'day' : 'days'}.`
      : '');

  return (
    <ChartCard
      title="Streaks"
      note={description}
      table={{
        columns: ['Days in a row', 'Length'],
        rows: runs.map((r) => ({
          label: formatDateSpan(r.start, r.end),
          cells: [`${r.length} ${r.length === 1 ? 'day' : 'days'}`],
        })),
      }}
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Current streak" value={String(summary.current_streak)} />
        <Stat label="Longest ever" value={String(summary.longest_streak)} />
        <Stat label="Longest in period" value={String(best?.length ?? 0)} />
      </dl>
      <ul role="img" aria-label={description} className="flex flex-wrap gap-1">
        {days.map((day) => (
          <li
            key={day.date}
            title={`${formatDate(day.date)}: ${day.sessions > 0 ? `${day.sessions} games` : 'no games'}`}
            className={`grid place-items-center rounded font-black text-white ${small ? 'size-3.5 text-[0px]' : 'size-7 text-xs'} ${
              day.sessions > 0 ? 'bg-brand-600' : 'bg-white ring-1 ring-slate-300'
            }`}
          >
            {day.sessions > 0 ? '✓' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-4 text-sm text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-1">
          <span className="grid size-4 place-items-center rounded bg-brand-600 text-[10px] text-white">
            ✓
          </span>
          Played
        </span>
        <span className="flex items-center gap-1">
          <span className="size-4 rounded bg-white ring-1 ring-slate-300" /> No games
        </span>
      </p>
    </ChartCard>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5 rounded-2xl bg-brand-50 p-3 print:bg-white print:ring-1 print:ring-slate-300">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-2xl font-black tabular-nums">{value}</dd>
    </div>
  );
}

export function GoalsProgress({
  goals,
  childId,
}: {
  goals: Summary['active_goals'];
  childId: string;
}) {
  // Goals are set by the parent; a therapist sees them but has nowhere to set one.
  const { isParent, childPath } = useChildArea();
  return (
    <section className="break-inside-avoid rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-6 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <h2 className="text-xl font-black">Goals</h2>
      {goals.length === 0 ? (
        <p className="mt-3 text-ink-soft">
          No active goals.{' '}
          {isParent && (
            <Link
              to={childPath(childId)}
              className="font-bold text-brand-700 underline print:hidden"
            >
              Set one on the profile page
            </Link>
          )}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {goals.map((goal) => (
            <li key={goal.id} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-bold">{goal.title}</span>
                <span className="text-ink-soft tabular-nums">
                  {goal.current_value} of {goal.target_value} games
                  {goal.due_date && ` · due ${formatDate(goal.due_date)}`}
                </span>
              </div>
              <ProgressBar value={goal.current_value} max={goal.target_value} label={goal.title} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Badges earned (newest first), and how many are still to unlock. */
export function BadgesEarned({
  achievements,
  since,
}: {
  achievements: Achievement[];
  since?: string;
}) {
  const earned = achievements
    .filter((a) => a.unlocked_at)
    .sort((a, b) => b.unlocked_at!.localeCompare(a.unlocked_at!));
  const locked = achievements.length - earned.length;
  return (
    <section className="break-inside-avoid rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-6 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <h2 className="text-xl font-black">Badges</h2>
      <p className="mt-1 text-ink-soft">
        {earned.length} earned{locked > 0 && `, ${locked} still to unlock`}.
      </p>
      {earned.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {earned.map((badge) => {
            const isNew = since !== undefined && badge.unlocked_at!.slice(0, 10) >= since;
            return (
              <li
                key={badge.code}
                className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3 print:bg-white"
              >
                <span className="text-3xl" aria-hidden="true">
                  {achievementEmoji(badge.icon)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {badge.title}
                    {isNew && (
                      <span className="ml-2 rounded-full bg-sun-200 px-2 py-0.5 text-xs font-black">
                        New in this period
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-ink-soft">
                    {badge.description} · {formatDay(badge.unlocked_at!)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
