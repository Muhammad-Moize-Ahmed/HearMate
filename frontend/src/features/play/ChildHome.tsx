import { Link } from 'react-router';

import { usePrincipal } from '../../auth/context';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useFamilyWeek, useGames, useLevels, useSpeechStatus, type Game } from './api';
import { gameLook, TIER_LABEL } from './meta';

/**
 * The child's home: big game tiles with their level, and their streak. It only reads games,
 * levels and this week's totals; therapist notes and learning plans are never fetched here
 * (the server refuses them to children anyway).
 */
export function ChildHome() {
  const principal = usePrincipal();
  const name = principal.kind === 'child' ? principal.display_name : '';
  const games = useGames();
  const levels = useLevels(principal.id);
  const speech = useSpeechStatus();
  const week = useFamilyWeek().data?.find((member) => member.child_id === principal.id);

  return (
    <div className="flex flex-col items-center gap-6 pt-2 text-center">
      <title>Play · HearMate</title>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-black sm:text-5xl">Hi {name}!</h1>
        <p className="text-2xl">Pick a game to play.</p>
        <Link
          to="/play/progress"
          className="inline-flex min-h-12 items-center gap-2 rounded-full bg-sun-300 px-5 text-xl font-black shadow-[0_4px_0_#ca8a04] active:translate-y-1 active:shadow-none"
        >
          <span aria-hidden="true">⭐</span> My progress
        </Link>
        {week && week.current_streak > 0 && (
          <p className="rounded-full bg-white/80 px-4 py-1.5 text-lg font-black">
            <span aria-hidden="true">🔥 </span>
            {week.current_streak} {week.current_streak === 1 ? 'day' : 'days'} in a row
          </p>
        )}
      </div>

      {games.isPending && (
        <p role="status" className="flex items-center gap-3 py-10 text-xl font-bold">
          <Spinner className="size-8 text-brand-600" /> Getting your games…
        </p>
      )}
      {games.isError && (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl bg-white p-6">
          <span className="text-5xl" aria-hidden="true">
            😕
          </span>
          <p className="text-xl font-bold">We couldn't load the games.</p>
          <Button onClick={() => void games.refetch()}>Try again</Button>
        </div>
      )}
      {games.isSuccess && games.data.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-white p-6">
          <span className="text-5xl" aria-hidden="true">
            🧸
          </span>
          <p className="text-xl font-bold">No games yet. Ask a grown-up to set them up!</p>
        </div>
      )}
      {games.isSuccess && games.data.length > 0 && (
        <ul className="grid w-full max-w-3xl grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {games.data.map((game) => (
            <li key={game.slug}>
              <GameTile
                game={game}
                level={levels.data?.find((l) => l.category === game.category)}
                needsSetup={game.requires_microphone && speech.data?.stt.available === false}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GameTile({
  game,
  level,
  needsSetup,
}: {
  game: Game;
  level: { level: number; difficulty: string } | undefined;
  needsSetup: boolean;
}) {
  const look = gameLook(game);
  const tier = level ? TIER_LABEL[level.difficulty] : undefined;
  return (
    <Link
      to={`/play/games/${game.slug}`}
      className={`flex h-full min-h-44 flex-col items-center justify-center gap-2 rounded-[2rem] p-5 shadow-[0_6px_0_var(--color-brand-200)] transition hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_var(--color-brand-200)] ${look.tile}`}
    >
      <span className="text-6xl" aria-hidden="true">
        {look.emoji}
      </span>
      <span className="text-2xl font-black">{game.title}</span>
      {level && (
        <span className="rounded-full bg-white/80 px-3 py-1 font-bold">
          {tier && <span aria-hidden="true">{tier.emoji} </span>}
          Level {level.level}
        </span>
      )}
      {game.requires_microphone && (
        <span className="text-sm font-semibold">
          {needsSetup ? 'Not ready yet' : '🎤 Uses the microphone'}
        </span>
      )}
    </Link>
  );
}
