import { useParams } from 'react-router';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { formatDate } from '../../lib/dates';
import { BackLink, ChildLoadError, Loading } from '../children/common';
import { useChild } from '../children/queries';
import { useGames } from '../play/api';
import { useAchievements, useSummary, useTrend } from './api';
import { RangeFilter } from './RangeFilter';
import { useRange } from './useRange';
import {
  ActivityChart,
  BadgesEarned,
  GoalsProgress,
  LevelsChart,
  ScoresChart,
  Stat,
  StreakHistory,
} from './sections';

/** A parent's view of one child's progress over a chosen period, as charts. */
export function ProgressPage() {
  const { childId = '' } = useParams();
  const [range, setRange] = useRange('month');
  const child = useChild(childId);
  const summary = useSummary(childId, range);
  const trend = useTrend(childId, range);
  const achievements = useAchievements(childId);
  const games = useGames();

  if (child.isPending) return <Loading label="Loading progress…" />;
  if (child.isError) return <ChildLoadError error={child.error} />;
  const name = child.data.display_name;

  return (
    <div className="flex flex-col gap-6">
      <title>{`${name}'s progress · HearMate`}</title>
      <div>
        <BackLink to={`/parent/children/${childId}`}>{`${name}'s profile`}</BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black sm:text-4xl">{name}'s progress</h1>
            {summary.data && (
              <p className="text-lg text-ink-soft">
                {formatDate(summary.data.period.start)} – {formatDate(summary.data.period.end)}
              </p>
            )}
          </div>
          <LinkButton to={`/parent/children/${childId}/report`} variant="secondary">
            Detailed report
          </LinkButton>
        </div>
      </div>

      <RangeFilter range={range} onChange={setRange} />

      {(summary.isPending || trend.isPending) && !(summary.isError || trend.isError) && (
        <Loading label="Loading progress…" />
      )}
      {(summary.isError || trend.isError) && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">
            We couldn't load {name}'s progress. {describeError((summary.error ?? trend.error)!)}
          </Alert>
          <Button
            variant="secondary"
            onClick={() => {
              void summary.refetch();
              void trend.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {summary.data && trend.data && (
        <div
          className={`flex flex-col gap-6 transition-opacity ${summary.isPlaceholderData || trend.isPlaceholderData ? 'opacity-60' : ''}`}
          aria-busy={summary.isPlaceholderData || trend.isPlaceholderData}
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Games in period" value={String(summary.data.in_period.sessions)} />
            <Stat label="Minutes practised" value={String(summary.data.in_period.minutes)} />
            <Stat label="Points" value={String(summary.data.in_period.points)} />
            <Stat label="Day streak" value={String(summary.data.current_streak)} />
          </dl>
          <ScoresChart days={trend.data} games={games.data ?? []} />
          <LevelsChart days={trend.data} />
          <ActivityChart days={trend.data} />
          <StreakHistory days={trend.data} summary={summary.data} />
          <GoalsProgress goals={summary.data.active_goals} childId={childId} />
          {achievements.data && (
            <BadgesEarned achievements={achievements.data} since={summary.data.period.start} />
          )}
          {achievements.isError && (
            <Alert tone="error">
              We couldn't load the badges. {describeError(achievements.error)}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
