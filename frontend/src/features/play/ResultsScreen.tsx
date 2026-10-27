import type { ReactNode } from 'react';

import { Button, LinkButton } from '../../components/ui/Button';
import type { Session } from './api';
import { achievementEmoji, CHEER, starsFor } from './meta';

/** The end of a game: stars, points, the level decision, streak and any new badges. */
export function ResultsScreen({
  session,
  onPlayAgain,
}: {
  session: Session;
  onPlayAgain: () => void;
}) {
  const result = session.result;
  if (!result) return null;
  const stars = starsFor(result.accuracy);
  const levelChange = result.level_after - result.level_before;

  return (
    <div className="flex animate-pop-in flex-col items-center gap-6 text-center">
      <title>{`${CHEER[stars]} · HearMate`}</title>
      <p className="text-6xl tracking-widest" role="img" aria-label={`${stars} out of 3 stars`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= stars ? '' : 'opacity-25 grayscale'}>
            ⭐
          </span>
        ))}
      </p>
      <h1 className="text-4xl font-black sm:text-5xl">{CHEER[stars]}</h1>
      <p className="text-2xl">
        You got <strong>{result.correct_rounds}</strong> of <strong>{result.total_rounds}</strong>{' '}
        right
      </p>
      <p className="rounded-full bg-sun-200 px-5 py-2 text-xl font-black">
        +{result.points} points
      </p>

      <div className="flex w-full max-w-md flex-col gap-3">
        <Card emoji={levelChange > 0 ? '🚀' : levelChange < 0 ? '🌱' : '🎯'}>
          {levelChange > 0 ? (
            <>
              <strong>Level up!</strong> You're on level {result.level_after} now.
            </>
          ) : levelChange < 0 ? (
            <>Next time it will be a little easier. You're on level {result.level_after}.</>
          ) : (
            <>You're on level {result.level_after}. Keep going!</>
          )}
        </Card>
        {result.streak_days != null && result.streak_days > 0 && (
          <Card emoji="🔥">
            <strong>
              {result.streak_days} {result.streak_days === 1 ? 'day' : 'days'}
            </strong>{' '}
            in a row!
          </Card>
        )}
        {(result.new_achievements ?? []).map((badge) => (
          <Card key={badge.code} emoji={achievementEmoji(badge.icon)} highlight>
            <strong>New badge: {badge.title}</strong>
            <span className="block text-base text-ink-soft">{badge.description}</span>
          </Card>
        ))}
        {(result.goals_achieved ?? []).map((goal) => (
          <Card key={goal} emoji="🏆" highlight>
            <strong>Goal reached:</strong> {goal}
          </Card>
        ))}
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <Button variant="sunny" size="xl" fullWidth onClick={onPlayAgain}>
          Play again
        </Button>
        <LinkButton to="/play" variant="secondary" size="xl" fullWidth>
          Other games
        </LinkButton>
      </div>
    </div>
  );
}

function Card({
  emoji,
  highlight = false,
  children,
}: {
  emoji: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-3xl p-4 text-left text-lg ${
        highlight ? 'bg-mint-200' : 'bg-white'
      }`}
    >
      <span className="text-4xl" aria-hidden="true">
        {emoji}
      </span>
      <p>{children}</p>
    </div>
  );
}
