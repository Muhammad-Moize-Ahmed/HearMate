import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { formatDate, formatDay } from '../../lib/dates';
import { BackLink, ChildLoadError, Loading } from '../children/common';
import { useChild } from '../children/queries';
import { useGames } from '../play/api';
import { soundLetters, TIER_LABEL } from '../play/meta';
import { useReport, useTrend, type Report } from './api';
import { DataTable } from './charts/ChartCard';
import { RangeFilter } from './RangeFilter';
import { useRange } from './useRange';
import { GoalsProgress, ScoresChart, Stat } from './sections';
import { skillLabel } from './transform';

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '–' : `${Math.round(value)}%`;

const NOISE_LABELS: Record<string, string> = {
  quiet: 'Quiet background',
  moderate: 'Some noise',
  loud: 'Loud noise',
};

/**
 * The detailed report for a period (week, month, 3 months or custom). Laid out to print well,
 * so "Print" gives a clean page or PDF without a PDF library: controls are hidden, sections
 * don't split across pages, and every chart's numbers are also in a table.
 */
export function ReportPage() {
  const { childId = '' } = useParams();
  const [range, setRange] = useRange('month');
  const child = useChild(childId);
  const report = useReport(childId, range);
  const trend = useTrend(childId, range);
  const games = useGames();

  if (child.isPending) return <Loading label="Loading report…" />;
  if (child.isError) return <ChildLoadError error={child.error} />;
  const name = child.data.display_name;

  return (
    <div className="flex flex-col gap-6 print:gap-5">
      <title>{`${name}'s report · HearMate`}</title>
      <div className="print:hidden">
        <BackLink to={`/parent/children/${childId}/progress`}>{`${name}'s progress`}</BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-black sm:text-4xl">{name}'s report</h1>
          <Button onClick={() => window.print()} disabled={!report.data}>
            <span aria-hidden="true">🖨️</span> Print or save as PDF
          </Button>
        </div>
      </div>

      <RangeFilter range={range} onChange={setRange} />

      {report.isPending && !report.isError && <Loading label="Loading report…" />}
      {report.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">We couldn't load the report. {describeError(report.error)}</Alert>
          <Button variant="secondary" onClick={() => void report.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {report.data && (
        <div
          className={`flex flex-col gap-6 transition-opacity print:gap-5 ${report.isPlaceholderData ? 'opacity-60' : ''}`}
          aria-busy={report.isPlaceholderData}
        >
          <ReportHeader name={name} report={report.data} />
          <Overview report={report.data} />
          {trend.data && <ScoresChart days={trend.data} games={games.data ?? []} />}
          <GamesTable report={report.data} />
          <NoiseTable report={report.data} />
          <Speech report={report.data} />
          <Contrasts report={report.data} />
          <LevelChanges report={report.data} />
          <GoalsProgress goals={report.data.summary.active_goals} childId={childId} />
        </div>
      )}
    </div>
  );
}

function ReportHeader({ name, report }: { name: string; report: Report }) {
  const { period } = report.summary;
  return (
    <header className="rounded-[2rem] bg-brand-50 p-5 sm:p-6 print:rounded-none print:border-b-2 print:border-ink print:bg-white print:p-0 print:pb-3">
      <p className="font-bold text-brand-700 print:text-ink">HearMate progress report</p>
      <h2 className="text-2xl font-black">{name}</h2>
      <p className="text-ink-soft">
        {formatDate(period.start)} – {formatDate(period.end)} ({period.days} days, times in{' '}
        {period.timezone.replaceAll('_', ' ')})
      </p>
      <p className="text-sm text-ink-soft">
        Created{' '}
        {new Date(report.generated_at).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </p>
    </header>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-6 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <h2 className="text-xl font-black">{title}</h2>
      {note && <p className="mt-1 text-ink-soft">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className="rounded-2xl bg-brand-50 p-4 text-ink-soft print:bg-white print:p-0">{children}</p>
  );
}

function Overview({ report }: { report: Report }) {
  const { summary } = report;
  return (
    <Section title="Overview">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Games played" value={String(summary.in_period.sessions)} />
        <Stat label="Minutes practised" value={String(summary.in_period.minutes)} />
        <Stat label="Points" value={String(summary.in_period.points)} />
        <Stat label="Current streak (days)" value={String(summary.current_streak)} />
        <Stat label="Longest streak (days)" value={String(summary.longest_streak)} />
        <Stat label="Badges earned" value={String(summary.achievements_unlocked)} />
      </dl>
      <h3 className="mt-5 mb-1 text-lg font-black">Skills</h3>
      <DataTable
        caption="Skills"
        table={{
          columns: ['Skill', 'Level now', 'Games', 'Average score', 'Change'],
          rows: summary.skills.map((skill) => ({
            label: skillLabel(skill.category),
            cells: [
              `${skill.level} (${TIER_LABEL[skill.difficulty]?.label ?? skill.difficulty})`,
              String(skill.sessions),
              percent(skill.average_accuracy),
              change(skill.accuracy_change),
            ],
          })),
        }}
      />
      <p className="mt-2 text-sm text-ink-soft">
        Change compares the second half of the period with the first (needs 4 or more games).
      </p>
    </Section>
  );
}

function change(value: number | null): string {
  if (value === null) return '–';
  if (value === 0) return 'No change';
  return `${value > 0 ? '▲ up' : '▼ down'} ${Math.abs(value)} points`;
}

function GamesTable({ report }: { report: Report }) {
  return (
    <Section title="Games">
      {report.games.length === 0 ? (
        <Empty>No games in this period.</Empty>
      ) : (
        <DataTable
          caption="Games"
          table={{
            columns: ['Game', 'Played', 'Average score', 'Best score', 'Average answer time'],
            rows: report.games.map((game) => ({
              label: game.title,
              cells: [
                String(game.sessions),
                percent(game.average_accuracy),
                percent(game.best_accuracy),
                game.average_response_ms === null
                  ? '–'
                  : `${(game.average_response_ms / 1000).toFixed(1)} s`,
              ],
            })),
          }}
        />
      )}
    </Section>
  );
}

function NoiseTable({ report }: { report: Report }) {
  return (
    <Section
      title="Listening in noise"
      note="Correct answers by how loud the background noise was (lower dB means louder noise)."
    >
      {report.listening_in_noise.length === 0 ? (
        <Empty>No rounds with background noise in this period.</Empty>
      ) : (
        <DataTable
          caption="Listening in noise"
          table={{
            columns: ['Noise', 'Signal to noise', 'Rounds', 'Correct'],
            rows: report.listening_in_noise.map((band) => ({
              label: NOISE_LABELS[band.band] ?? band.band,
              cells: [band.snr_range_db, String(band.rounds), percent(band.accuracy)],
            })),
          }}
        />
      )}
    </Section>
  );
}

function Speech({ report }: { report: Report }) {
  const { speech } = report;
  return (
    <Section title="Speaking">
      {speech.attempts === 0 ? (
        <Empty>No speaking practice in this period.</Empty>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Words spoken" value={String(speech.attempts)} />
            <Stat label="Average score" value={percent(speech.average_score)} />
          </dl>
          {speech.sounds_to_practise.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 font-black">Sounds to practise</h3>
              <ul className="flex flex-wrap gap-2">
                {speech.sounds_to_practise.map((s) => (
                  <li
                    key={s.sound}
                    className="rounded-full bg-sun-200 px-3 py-1 print:ring-1 print:ring-slate-400"
                  >
                    <strong>“{soundLetters(s.sound)}”</strong> ({s.sound}) · missed {s.misses}{' '}
                    {s.misses === 1 ? 'time' : 'times'}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function Contrasts({ report }: { report: Report }) {
  return (
    <Section
      title="Hardest sound pairs"
      note="Pairs of similar sounds from Similar Sounds, hardest first."
    >
      {report.hardest_contrasts.length === 0 ? (
        <Empty>No Similar Sounds rounds in this period.</Empty>
      ) : (
        <DataTable
          caption="Hardest sound pairs"
          table={{
            columns: ['Sounds', 'Rounds', 'Correct'],
            rows: report.hardest_contrasts.map((c) => ({
              label: c.contrast,
              cells: [String(c.rounds), percent(c.accuracy)],
            })),
          }}
        />
      )}
    </Section>
  );
}

function LevelChanges({ report }: { report: Report }) {
  return (
    <Section title="Level changes">
      {report.level_changes.length === 0 ? (
        <Empty>No level changes in this period.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {report.level_changes.map((c) => (
            <li key={`${c.category}-${c.changed_at}`} className="flex flex-wrap gap-x-2">
              <span className="font-bold tabular-nums">{formatDay(c.changed_at)}</span>
              <span>
                {skillLabel(c.category)}: level {c.old_level} → {c.new_level}{' '}
                <span className="sr-only">{c.new_level > c.old_level ? '(up)' : '(down)'}</span>
                <span aria-hidden="true">{c.new_level > c.old_level ? '▲' : '▼'}</span>
              </span>
              <span className="text-ink-soft">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
