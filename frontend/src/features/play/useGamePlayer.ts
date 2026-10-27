import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { ApiError } from '../../api/client';
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

/** Runs one game session against the server. The client only ever sends answers. */
export function useGamePlayer({ childId, slug, resumeSessionId, onStarted }: Options) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(
    playerReducer,
    resumeSessionId ? ({ phase: 'loading' } as const) : ({ phase: 'intro' } as const),
  );

  // Resume: a session from another game, or one that can't be read, starts fresh instead.
  useEffect(() => {
    if (state.phase !== 'loading' || !resumeSessionId) return;
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
  }, [state.phase, resumeSessionId, slug, childId]);

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
    if (completingId === null || completing.current === completingId) return;
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
  }, [completingId, childId, queryClient]);

  const start = useCallback(
    (withNoise: boolean) => {
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
      if (state.phase !== 'round') return;
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
    [state],
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
    start,
    answer,
    answerSpeech,
    next: () => dispatch({ type: 'next' }),
    retryComplete: () => dispatch({ type: 'retry-complete' }),
    quit,
  };
}
