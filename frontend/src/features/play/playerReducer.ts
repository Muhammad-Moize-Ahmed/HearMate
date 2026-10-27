/**
 * The game player as a state machine. The server owns the session (rounds, scoring, levels); this
 * only tracks where the child is in it:
 *
 *   intro -> starting -> round -> checking -> feedback -> round ... -> completing -> done
 *
 * Actions that don't fit the current phase are ignored, so a double tap or a repeated effect
 * can't skip a round or complete twice.
 */
import type { AnswerResult, Session } from './api';

export type PlayerState =
  | { phase: 'loading' } // resuming a session named in the URL
  | { phase: 'intro'; error?: Error }
  | { phase: 'starting' }
  | { phase: 'round'; session: Session; index: number; error?: Error }
  | { phase: 'checking'; session: Session; index: number }
  | { phase: 'feedback'; session: Session; index: number; result: AnswerResult }
  | { phase: 'completing'; session: Session; error?: Error }
  | { phase: 'done'; session: Session };

export type PlayerAction =
  | { type: 'resume-failed' }
  | { type: 'start' }
  | { type: 'start-failed'; error: Error }
  | { type: 'session'; session: Session }
  | { type: 'answering' }
  | { type: 'answered'; result: AnswerResult }
  | { type: 'answer-failed'; error: Error }
  | { type: 'next' }
  | { type: 'completed'; session: Session }
  | { type: 'complete-failed'; error: Error }
  | { type: 'retry-complete' };

/** The first round still to answer, or null when every round has an answer. */
export function firstUnanswered(session: Session): number | null {
  const round = session.rounds.find((r) => !r.answered);
  return round ? round.index : null;
}

/** Where a session (fresh, resumed or re-read) puts the player. */
function fromSession(session: Session): PlayerState {
  if (session.status === 'completed') return { phase: 'done', session };
  if (session.status === 'abandoned') return { phase: 'intro' };
  const index = firstUnanswered(session);
  return index === null ? { phase: 'completing', session } : { phase: 'round', session, index };
}

/** The session with one round's answer recorded, so "what's next" needs no refetch. */
function withAnswer(session: Session, result: AnswerResult): Session {
  return {
    ...session,
    rounds: session.rounds.map((r) =>
      r.index === result.index
        ? {
            ...r,
            answered: true,
            is_correct: result.is_correct,
            correct_answer: result.correct_answer,
          }
        : r,
    ),
  };
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'resume-failed':
      return state.phase === 'loading' ? { phase: 'intro' } : state;
    case 'start':
      return state.phase === 'intro' || state.phase === 'done' ? { phase: 'starting' } : state;
    case 'start-failed':
      return state.phase === 'starting' ? { phase: 'intro', error: action.error } : state;
    case 'session':
      return fromSession(action.session);
    case 'answering':
      return state.phase === 'round'
        ? { phase: 'checking', session: state.session, index: state.index }
        : state;
    case 'answered':
      return state.phase === 'checking' && action.result.index === state.index
        ? {
            phase: 'feedback',
            session: withAnswer(state.session, action.result),
            index: state.index,
            result: action.result,
          }
        : state;
    case 'answer-failed':
      return state.phase === 'checking'
        ? { phase: 'round', session: state.session, index: state.index, error: action.error }
        : state;
    case 'next':
      return state.phase === 'feedback' ? fromSession(state.session) : state;
    case 'completed':
      return state.phase === 'completing' ? { phase: 'done', session: action.session } : state;
    case 'complete-failed':
      return state.phase === 'completing' ? { ...state, error: action.error } : state;
    case 'retry-complete':
      return state.phase === 'completing' ? { phase: 'completing', session: state.session } : state;
  }
}
