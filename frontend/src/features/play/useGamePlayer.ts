import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { setGameActive } from '../../lib/gameActivity';
import { isOnline, subscribeOnline, useOnline } from '../../lib/network';
import {
  abandonSession,
  answerRound,
  answerWithSpeech,
  completeSession,
  getSession,
  playKeys,
  startSession,
  type AnswerBody,
  type AnswerResult,
} from './api';
import { playerReducer, type PlayerState } from './playerReducer';

const MAX_RESPONSE_MS = 600_000;

type Options = {
  childId: string;
  slug: string;
  /** A session to pick up again (from the URL), e.g. after a page reload. */
  resumeSessionId: string | null;
  /** Called when a new session starts, so the URL can name it. */
  onStarted: (sessionId: string) => void;
};

/** Phases where a session is under way: a reload or an interruption would cut into the game. */
const IN_GAME = new Set<PlayerState['phase']>(['round', 'checking', 'feedback', 'completing']);

/**
 * Runs one game session against the server. The client only ever sends answers.
 *
 * Offline: a game can't start, and nothing is sent or queued. If the connection drops mid-game the
 * player pauses (`paused`); when it's back, the session is read again from the server, exactly as
 * when resuming after a reload, and the game carries on from the first unanswered round.
 */
export function useGamePlayer({ childId, slug, resumeSessionId, onStarted }: Options) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [state, dispatch] = useReducer(
    playerReducer,
    resumeSessionId ? ({ phase: 'loading' } as const) : ({ phase: 'intro' } as const),
  );
  const inGame = IN_GAME.has(state.phase);

  // Tell the rest of the app (update prompt, offline banner) not to interrupt.
  useEffect(() => setGameActive(inGame), [inGame]);
  useEffect(() => () => setGameActive(false), []);

  // Back online after a drop: re-read the session (the resume path) before letting the child answer,
  // so an answer the server got just before the drop isn't asked again.
  const [resyncing, setResyncing] = useState(false);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  useEffect(
    () =>
      subscribeOnline((nowOnline) => {
        const current = latest.current;
        if (!nowOnline) return;
        if (current.phase === 'completing' && current.error) {
          dispatch({ type: 'retry-complete' });
          return;
        }
        // Feedback already has its result; an answer still on its way settles by itself.
        if (current.phase !== 'round') return;
        setResyncing(true);
        getSession(current.session.id)
          .then(
            (fresh) => dispatch({ type: 'session', session: fresh }),
            () => undefined, // couldn't re-read: carry on from where the child was
          )
          .finally(() => setResyncing(false));
      }),
    [],
  );

  // Resume: a session from another game, or one that can't be read, starts fresh instead.
  // Offline, it waits for the connection rather than giving up on the session.
  useEffect(() => {
    if (state.phase !== 'loading' || !resumeSessionId || !online) return;
    let active = true;
    getSession(resumeSessionId).then(
      (session) => {
        if (!active) return;
        if (session.game.slug === slug && session.child_id === childId) {
          dispatch({ type: 'session', session });
        } else {
          dispatch({ type: 'resume-failed' });
        }
      },
      () => active && dispatch({ type: 'resume-failed' }),
    );
    return () => {
      active = false;
    };
  }, [state.phase, resumeSessionId, slug, childId, online]);

  // How long the child took: from the round appearing to the answer.
  const shownAt = useRef(0);
  const roundIndex = state.phase === 'round' ? state.index : null;
  useEffect(() => {
    if (roundIndex !== null) shownAt.current = performance.now();
  }, [roundIndex]);
  const elapsed = () =>
    Math.min(MAX_RESPONSE_MS, Math.max(0, Math.round(performance.now() - shownAt.current)));

  // Completing runs once per session, even if the effect runs twice (React strict mode).
  const completing = useRef<string | null>(null);
  const completingId = state.phase === 'completing' && !state.error ? state.session.id : null;
  useEffect(() => {
    if (completingId === null || completing.current === completingId || !online) return;
    completing.current = completingId;
    completeSession(completingId).then(
      (session) => {
        dispatch({ type: 'completed', session });
        // Levels, streaks and badges changed: refresh what the home screen shows.
        void queryClient.invalidateQueries({ queryKey: playKeys.levels(childId) });
        void queryClient.invalidateQueries({ queryKey: playKeys.family });
      },
      (error: Error) => {
        completing.current = null;
        dispatch({ type: 'complete-failed', error });
      },
    );
  }, [completingId, childId, queryClient, online]);

  const start = useCallback(
    (withNoise: boolean) => {
      if (!isOnline()) return; // the intro says why
      dispatch({ type: 'start' });
      startSession({ child_id: childId, game: slug, with_noise: withNoise }).then(
        (session) => {
          onStarted(session.id);
          dispatch({ type: 'session', session });
        },
        (error: Error) => dispatch({ type: 'start-failed', error }),
      );
    },
    [childId, slug, onStarted],
  );

  const submit = useCallback(
    (send: (sessionId: string, index: number, ms: number) => Promise<AnswerResult>) => {
      // Offline, answers are never queued: the player is paused until the connection is back.
      if (state.phase !== 'round' || !isOnline() || resyncing) return;
      const { session, index } = state;
      dispatch({ type: 'answering' });
      send(session.id, index, elapsed()).then(
        (result) => dispatch({ type: 'answered', result }),
        async (error: Error) => {
          // Already answered (e.g. on another tab): re-read the session and carry on from there.
          if (error instanceof ApiError && error.code === 'already_answered') {
            const fresh = await getSession(session.id).catch(() => null);
            if (fresh) return dispatch({ type: 'session', session: fresh });
          }
          dispatch({ type: 'answer-failed', error });
        },
      );
    },
    [state, resyncing],
  );

  const answer = useCallback(
    (body: AnswerBody) => submit((id, index, ms) => answerRound(id, index, body, ms)),
    [submit],
  );
  const answerSpeech = useCallback(
    (recording: Blob) => submit((id, index, ms) => answerWithSpeech(id, index, recording, ms)),
    [submit],
  );

  /** Stop early. Abandoned sessions don't change levels; failures here don't matter. */
  const quit = useCallback(async () => {
    if ('session' in state && state.session.status === 'in_progress' && state.phase !== 'done') {
      await abandonSession(state.session.id).catch(() => undefined);
    }
  }, [state]);

  return {
    state: state as PlayerState,
    online,
    /** Mid-game with no connection (or catching up after one): show "reconnecting", take no answers. */
    paused: inGame && (!online || resyncing),
    start,
    answer,
    answerSpeech,
    next: () => dispatch({ type: 'next' }),
    retryComplete: () => dispatch({ type: 'retry-complete' }),
    quit,
  };
}
