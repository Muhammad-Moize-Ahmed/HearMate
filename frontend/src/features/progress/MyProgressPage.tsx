import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { usePrincipal } from '../../auth/context';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { avatarEmoji } from '../../lib/avatars';
import { useFamilyWeek, useGames } from '../play/api';
import { achievementEmoji, gameLook, starsFor } from '../play/meta';
import { useAchievements, usePersonalBests, useTrend, type PersonalBest } from './api';
import { totalStars } from './transform';

const WEEK = { kind: 'week', days: 7 } as const;

/**
 * The child's own progress: stars, badges, best results and this week. It only compares a child
 * with themselves, and with brothers and sisters (no one outside the family). It reads no
 * therapist notes or learning plans.
 */
export function MyProgressPage() {
  const principal = usePrincipal();
  const childId = principal.id;
  const bests = usePersonalBests(childId);
  const games = useGames();
  const achievements = useAchievements(childId);
  const week = useTrend(childId, WEEK);
  const family = useFamilyWeek();

  return (
    <div className="flex flex-col gap-6 pt-2">
      <title>My progress · HearMate</title>
      <div className="flex flex-col items-center gap-3 text-center">
        <Link
          to="/play"
          className="inline-flex min-h-12 items-center gap-2 self-start rounded-full bg-white/80 px-4 text-lg font-black shadow-sm"
        >
          <span aria-hidden="true">←</span> Games
        </Link>
        <h1 className="text-4xl font-black sm:text-5xl">My progress</h1>
        {bests.data && (
          <p className="rounded-full bg-white/90 px-5 py-2 text-2xl font-black shadow-sm">
            <span aria-hidden="true">⭐ </span>
            {totalStars(bests.data)} {totalStars(bests.data) === 1 ? 'star' : 'stars'}
          </p>
        )}
      </div>

      {(bests.isPending || games.isPending) && <Waiting>Counting your stars…</Waiting>}
      {(bests.isError || games.isError) && (
        <Oops
          onRetry={() => {
            void bests.refetch();
            void games.refetch();
          }}
        >
          We couldn't load your stars.
        </Oops>
      )}
      {bests.data && games.data && (
        <Panel title="My best games" emoji="🏆">
          {games.data.length === 0 ? (
            <p className="text-xl font-bold">No games yet.</p>
          ) : (
            <ul className="grid gap-3 min-[420px]:grid-cols-2">
              {games.data.map((game) => (
                <li key={game.slug}>
                  <BestCard
                    title={game.title}
                    emoji={gameLook(game).emoji}
                    best={bests.data.find((b) => b.game === game.slug)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {week.data && (
        <Panel title="My week" emoji="📅">
          <ol className="flex justify-between gap-1">
            {week.data.map((day) => {
              const played = day.sessions > 0;
              const weekday = new Intl.DateTimeFormat(undefined, {
                weekday: 'short',
                timeZone: 'UTC',
              }).format(new Date(`${day.date}T00:00:00Z`));
              return (
                <li key={day.date} className="flex flex-col items-center gap-1">
                  <span
                    className={`grid size-10 place-items-center rounded-full text-xl font-black sm:size-12 ${
                      played
                        ? 'bg-mint-300 shadow-[0_3px_0_#059669]'
                        : 'bg-white ring-2 ring-slate-200'
                    }`}
                    aria-hidden="true"
                  >
                    {played ? '✓' : ''}
                  </span>
                  <span className="text-sm font-bold">
                    {weekday}
                    <span className="sr-only">{played ? ': played' : ': no games'}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {achievements.isPending && <Waiting>Finding your badges…</Waiting>}
      {achievements.isError && (
        <Oops onRetry={() => void achievements.refetch()}>We couldn't load your badges.</Oops>
      )}
      {achievements.data && (
        <Panel title="My badges" emoji="🏅">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {achievements.data.map((badge) => {
              const earned = badge.unlocked_at !== null && badge.unlocked_at !== undefined;
              return (
                <li
                  key={badge.code}
                  className={`flex flex-col items-center gap-1 rounded-3xl p-3 text-center ${
                    earned ? 'bg-sun-200' : 'bg-slate-100 text-ink-soft'
                  }`}
                >
                  <span className={`text-4xl ${earned ? '' : 'grayscale'}`} aria-hidden="true">
                    {earned ? achievementEmoji(badge.icon) : '🔒'}
                  </span>
                  <span className="font-black">{badge.title}</span>
                  <span className="text-sm">
                    {earned ? badge.description : 'Keep playing to unlock!'}
                  </span>
                  <span className="sr-only">{earned ? '(earned)' : '(not earned yet)'}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {family.data && family.data.length > 1 && (
        <Panel title="My family this week" emoji="🏠">
          <ul className="grid gap-3 min-[420px]:grid-cols-2">
            {family.data.map((member) => {
              const me = member.child_id === childId;
              return (
                <li
                  key={member.child_id}
                  className={`flex items-center gap-3 rounded-3xl p-3 ${me ? 'bg-sun-200 ring-4 ring-sun-300' : 'bg-brand-50'}`}
                >
                  <span
                    className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-4xl"
                    aria-hidden="true"
                  >
                    {avatarEmoji(member.avatar)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xl font-black">
                      {member.display_name}
                      {me && ' (you)'}
                    </span>
                    <span>
                      {member.this_week.sessions}{' '}
                      {member.this_week.sessions === 1 ? 'game' : 'games'}
                      {member.current_streak > 0 && (
                        <>
                          {' · '}
                          <span aria-hidden="true">🔥 </span>
                          {member.current_streak} {member.current_streak === 1 ? 'day' : 'days'} in
                          a row
                        </>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function BestCard({
  title,
  emoji,
  best,
}: {
  title: string;
  emoji: string;
  best: PersonalBest | undefined;
}) {
  const stars = best?.best_accuracy != null ? starsFor(best.best_accuracy) : 0;
  return (
    <div className="flex h-full items-center gap-3 rounded-3xl bg-brand-50 p-4">
      <span className="text-5xl" aria-hidden="true">
        {emoji}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xl font-black">{title}</span>
        {best ? (
          <>
            <span
              role="img"
              aria-label={`${stars} out of 3 stars`}
              className="text-2xl tracking-wider"
            >
              {'⭐'.repeat(stars)}
              <span className="opacity-30">{'☆'.repeat(3 - stars)}</span>
            </span>
            <span className="font-semibold">
              Best level {best.highest_level} · played {best.sessions}{' '}
              {best.sessions === 1 ? 'time' : 'times'}
            </span>
          </>
        ) : (
          <span className="font-semibold text-ink-soft">Not played yet</span>
        )}
      </div>
    </div>
  );
}

function Panel({ title, emoji, children }: { title: string; emoji: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] bg-white/90 p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-black">
        <span aria-hidden="true">{emoji}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Waiting({ children }: { children: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-3 py-6 text-xl font-bold">
      <Spinner className="size-8 text-brand-600" /> {children}
    </p>
  );
}

function Oops({ children, onRetry }: { children: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center"
    >
      <span className="text-5xl" aria-hidden="true">
        😕
      </span>
      <p className="text-xl font-bold">{children}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
