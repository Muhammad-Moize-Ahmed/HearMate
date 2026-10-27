import { useEffect, useRef, useState } from 'react';

import { Spinner } from '../../components/ui/Spinner';
import { audioProblemKind, type AudioProblemKind } from './audioProblem';

type AudioButtonProps = {
  audio: Blob | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Try to play as soon as the audio arrives (browsers may block it until a tap). */
  autoPlay?: boolean;
  label?: string;
};

/** The big "listen" button. The sound can be played as often as the child likes. */
export function AudioButton({
  audio,
  loading,
  error,
  onRetry,
  autoPlay = true,
  label = 'Listen',
}: AudioButtonProps) {
  const element = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    if (!audio) return;
    const url = URL.createObjectURL(audio);
    const player = new Audio(url);
    element.current = player;
    player.onplay = () => setPlaying(true);
    player.onended = player.onpause = () => setPlaying(false);
    if (autoPlay) {
      player.play().then(
        () => setNeedsTap(false),
        () => setNeedsTap(true), // autoplay blocked: wait for a tap
      );
    }
    return () => {
      player.pause();
      element.current = null;
      URL.revokeObjectURL(url);
    };
  }, [audio, autoPlay]);

  if (error) return <AudioProblem error={error} onRetry={onRetry} />;

  const play = () => {
    const player = element.current;
    if (!player) return;
    player.currentTime = 0;
    void player.play().then(
      () => setNeedsTap(false),
      () => setNeedsTap(true),
    );
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={play}
        disabled={loading || !audio}
        aria-label={loading ? 'Loading the sound' : playing ? `${label} (playing)` : label}
        className={`grid size-32 place-items-center rounded-full bg-sun-300 text-6xl shadow-[0_6px_0_#ca8a04] transition active:translate-y-1 active:shadow-[0_2px_0_#ca8a04] disabled:opacity-60 sm:size-36 ${
          playing ? 'motion-safe:animate-pulse' : ''
        }`}
      >
        {loading ? <Spinner className="size-12 text-ink" /> : <span aria-hidden="true">🔊</span>}
      </button>
      <p className="text-lg font-bold" aria-live="polite">
        {loading
          ? 'Getting ready…'
          : needsTap
            ? 'Tap to listen!'
            : playing
              ? 'Listen…'
              : 'Tap to hear it again'}
      </p>
    </div>
  );
}

const PROBLEM_TEXT: Record<AudioProblemKind, { title: string; hint: string }> = {
  missing: {
    title: "Oh no! This sound isn't ready yet.",
    hint: 'Ask a grown-up to set up the sounds, then try another game.',
  },
  refused: {
    title: "Oh no! This sound won't play.",
    hint: 'Ask a grown-up for help, then try another game.',
  },
  retry: { title: "We couldn't load the sound.", hint: 'Check the internet and try again.' },
};

/** Why the sound can't play. Only a problem that asking again could fix offers "Try again". */
function AudioProblem({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const kind = audioProblemKind(error);
  const text = PROBLEM_TEXT[kind];
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-3xl bg-white p-5 text-center"
    >
      <span className="text-5xl" aria-hidden="true">
        🙉
      </span>
      <p className="text-lg font-bold">{text.title}</p>
      <p className="text-ink-soft">{text.hint}</p>
      {kind === 'retry' && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-12 rounded-2xl bg-brand-600 px-6 font-bold text-white"
        >
          Try again
        </button>
      )}
    </div>
  );
}
