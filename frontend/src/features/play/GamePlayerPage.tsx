import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { ApiError, describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Spinner } from '../../components/ui/Spinner';
import { ChoiceAnswer, SequenceAnswer, SpeechAnswer } from './answers';
import {
  useGames,
  useLevels,
  useSpeechStatus,
  useStimulus,
  type AnswerResult,
  type Game,
  type Session,
} from './api';
import { AudioButton } from './AudioButton';
import { answerKind, gameLook, TIER_LABEL } from './meta';
import { ResultsScreen } from './ResultsScreen';
import { RoundFeedback } from './RoundFeedback';
import { useGamePlayer } from './useGamePlayer';

export function GamePlayerPage() {
  const { slug = '' } = useParams();
  const principal = usePrincipal();
  const games = useGames();

  if (games.isPending) return <Centered>Getting the game ready…</Centered>;
  if (games.isError) {
    return (
      <Problem emoji="😕" title="We couldn't load the game.">
        <Button onClick={() => void games.refetch()}>Try again</Button>
      </Problem>
    );
  }
  const game = games.data.find((g) => g.slug === slug);
  if (!game) {
    return <Problem emoji="🙈" title="We can't find that game." />;
  }
  return <Player key={slug} game={game} childId={principal.id} />;
}

function Player({ game, childId }: { game: Game; childId: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [quitting, setQuitting] = useState(false);
  const onStarted = useCallback(
    (sessionId: string) => setParams({ session: sessionId }, { replace: true }),
    [setParams],
  );
  const player = useGamePlayer({
    childId,
    slug: game.slug,
    resumeSessionId: params.get('session'),
    onStarted,
  });
  const { state } = player;
  const look = gameLook(game);

  const leave = async () => {
    await player.quit();
    void navigate('/play');
  };

  return (
    <div className="flex flex-col gap-5">
      <title>{`${game.title} · HearMate`}</title>
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black sm:text-3xl">
          <span aria-hidden="true">{look.emoji}</span>
          {game.title}
        </h1>
        {state.phase !== 'done' && (
          <Button
            variant="secondary"
            onClick={() =>
              state.phase === 'intro' || state.phase === 'loading'
                ? void navigate('/play')
                : setQuitting(true)
            }
          >
            <span aria-hidden="true">✖</span> Stop
          </Button>
        )}
      </header>

      {state.phase === 'loading' && <Centered>Getting back to your game…</Centered>}
      {(state.phase === 'intro' || state.phase === 'starting') && (
        <Intro
          game={game}
          childId={childId}
          starting={state.phase === 'starting'}
          error={state.phase === 'intro' ? state.error : undefined}
          onStart={player.start}
        />
      )}
      {(state.phase === 'round' || state.phase === 'checking' || state.phase === 'feedback') && (
        <RoundScreen
          game={game}
          session={state.session}
          index={state.index}
          checking={state.phase === 'checking'}
          error={state.phase === 'round' ? state.error : undefined}
          feedback={state.phase === 'feedback' ? state.result : undefined}
          onAnswer={player.answer}
          onSpeech={player.answerSpeech}
          onNext={player.next}
          onLeave={() => void leave()}
        />
      )}
      {state.phase === 'completing' &&
        (state.error ? (
          <Problem emoji="😕" title="We couldn't save your game.">
            <p className="text-ink-soft">{describeError(state.error)}</p>
            <Button onClick={player.retryComplete}>Try again</Button>
          </Problem>
        ) : (
          <Centered>Counting your stars…</Centered>
        ))}
      {state.phase === 'done' && (
        <ResultsScreen
          session={state.session}
          onPlayAgain={() => player.start(state.session.with_noise)}
        />
      )}

      {quitting && (
        <ConfirmDialog
          title="Stop this game?"
          confirmLabel="Stop playing"
          onCancel={() => setQuitting(false)}
          onConfirm={() => void leave()}
        >
          <p>This game won't count. You can start again any time!</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Intro({
  game,
  childId,
  starting,
  error,
  onStart,
}: {
  game: Game;
  childId: string;
  starting: boolean;
  error: Error | undefined;
  onStart: (withNoise: boolean) => void;
}) {
  const levels = useLevels(childId);
  const speech = useSpeechStatus();
  const [withNoise, setWithNoise] = useState(false);
  const level = levels.data?.find((l) => l.category === game.category);
  const tier = level ? TIER_LABEL[level.difficulty] : undefined;
  const speechMissing = game.requires_microphone && speech.data?.stt.available === false;

  return (
    <div className="flex flex-col items-center gap-5 rounded-[2rem] bg-white/90 p-6 text-center shadow-sm">
      <span className="text-7xl" aria-hidden="true">
        {gameLook(game).emoji}
      </span>
      <p className="max-w-md text-xl">{game.description}</p>
      {level && tier && (
        <p className="rounded-full bg-brand-100 px-4 py-1.5 text-lg font-bold">
          <span aria-hidden="true">{tier.emoji} </span>Level {level.level}
        </p>
      )}
      {game.always_noise && (
        <p className="text-ink-soft">There's background noise. Listen carefully!</p>
      )}
      {game.supports_noise && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-sky-soft/60 px-4 text-lg font-bold">
          <input
            type="checkbox"
            checked={withNoise}
            onChange={(event) => setWithNoise(event.target.checked)}
            className="size-6 accent-brand-600"
          />
          <span aria-hidden="true">🌧️</span> Add background noise (harder!)
        </label>
      )}
      {game.requires_microphone && (
        <p className="text-ink-soft">
          <span aria-hidden="true">🎤 </span>You'll need the microphone for this one.
        </p>
      )}
      {error && <Alert tone="error">{describeError(error)}</Alert>}
      {speechMissing ? (
        <Alert tone="info">Speaking games aren't ready yet. Ask a grown-up to set them up.</Alert>
      ) : (
        <Button variant="sunny" size="xl" loading={starting} onClick={() => onStart(withNoise)}>
          Start! <span aria-hidden="true">🚀</span>
        </Button>
      )}
    </div>
  );
}

function RoundScreen({
  game,
  session,
  index,
  checking,
  error,
  feedback,
  onAnswer,
  onSpeech,
  onNext,
  onLeave,
}: {
  game: Game;
  session: Session;
  index: number;
  checking: boolean;
  error: Error | undefined;
  feedback: AnswerResult | undefined;
  onAnswer: ReturnType<typeof useGamePlayer>['answer'];
  onSpeech: (recording: Blob) => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  const round = session.rounds.find((r) => r.index === index);
  const stimulus = useStimulus(session.id, index, session.rounds.length);
  if (!round) return null;
  const { prompt } = round;
  const kind = answerKind(game.slug, prompt);
  const answered = session.rounds.filter((r) => r.answered).length;

  return (
    <div className="flex flex-col items-center gap-5">
      <Progress done={answered} total={session.rounds.length} />
      {feedback ? (
        <RoundFeedback result={feedback} prompt={prompt} kind={kind} onNext={onNext} />
      ) : (
        <>
          <p className="text-center text-2xl font-black">{prompt.instruction}</p>
          {prompt.noise && (
            <p className="rounded-full bg-sky-soft px-3 py-1 font-bold">
              <span aria-hidden="true">🌧️ </span>Noisy round
            </p>
          )}
          <AudioButton
            key={`${session.id}-${index}`}
            audio={stimulus.data}
            loading={stimulus.isPending}
            error={stimulus.error}
            onRetry={() => void stimulus.refetch()}
          />
          {stimulus.isError ? (
            <Button variant="secondary" onClick={onLeave}>
              Choose another game
            </Button>
          ) : (
            <>
              {prompt.display_text && (
                <p className="rounded-3xl bg-white px-6 py-4 text-center text-3xl font-black sm:text-4xl">
                  {prompt.display_text}
                </p>
              )}
              {error && <Alert tone="error">{answerErrorMessage(error)}</Alert>}
              {kind === 'choice' && (
                <ChoiceAnswer
                  options={prompt.options}
                  disabled={checking || !stimulus.data}
                  onAnswer={(choice) => onAnswer({ choice })}
                />
              )}
              {kind === 'sequence' && (
                <SequenceAnswer
                  key={index}
                  options={prompt.options}
                  length={prompt.answer_length ?? null}
                  disabled={checking || !stimulus.data}
                  onAnswer={(sequence) => onAnswer({ sequence })}
                />
              )}
              {kind === 'speech' && (
                <SpeechAnswer
                  key={index}
                  disabled={checking}
                  onRecorded={onSpeech}
                  onGiveUp={onLeave}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function answerErrorMessage(error: Error): string {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'invalid_audio') return "We couldn't hear that. Try again, a little louder!";
  if (code === 'audio_too_large') return 'That was a bit long. Try saying it again.';
  if (code === 'speech_unavailable') return "Speaking games aren't ready yet. Ask a grown-up.";
  return describeError(error);
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div
      role="img"
      aria-label={`Round ${Math.min(done + 1, total)} of ${total}`}
      className="flex flex-wrap justify-center gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-4 rounded-full ${
            i < done ? 'bg-brand-500' : i === done ? 'bg-sun-300 ring-2 ring-brand-500' : 'bg-white'
          }`}
        />
      ))}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-xl font-bold">
      <Spinner className="size-10 text-brand-600" />
      {children}
    </div>
  );
}

function Problem({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-[2rem] bg-white p-6 text-center"
    >
      <span className="text-6xl" aria-hidden="true">
        {emoji}
      </span>
      <p className="text-2xl font-black">{title}</p>
      {children}
      <LinkButton to="/play" variant="secondary">
        Back to games
      </LinkButton>
    </div>
  );
}
