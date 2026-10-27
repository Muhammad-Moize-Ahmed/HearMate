import { answerOut, completed, prompt, session } from '../../test/playFixtures';
import { firstUnanswered, playerReducer, type PlayerState } from './playerReducer';

const twoRounds = () => session('sound-detective', [prompt(), prompt()]);

function play(state: PlayerState, ...actions: Parameters<typeof playerReducer>[1][]) {
  return actions.reduce(playerReducer, state);
}

describe('playerReducer', () => {
  it('runs a session: start, answer each round, complete', () => {
    const s = twoRounds();
    let state = play({ phase: 'intro' }, { type: 'start' }, { type: 'session', session: s });
    expect(state).toMatchObject({ phase: 'round', index: 0 });

    state = play(
      state,
      { type: 'answering' },
      { type: 'answered', result: answerOut({ index: 0 }) },
    );
    expect(state).toMatchObject({ phase: 'feedback', index: 0 });

    state = play(state, { type: 'next' });
    expect(state).toMatchObject({ phase: 'round', index: 1 });

    state = play(
      state,
      { type: 'answering' },
      { type: 'answered', result: answerOut({ index: 1, rounds_remaining: 0 }) },
      { type: 'next' },
    );
    expect(state.phase).toBe('completing');

    state = play(state, { type: 'completed', session: completed(s) });
    expect(state.phase).toBe('done');
  });

  it('records the answer locally, so "next" needs no refetch', () => {
    const state = play(
      { phase: 'intro' },
      { type: 'start' },
      { type: 'session', session: twoRounds() },
      { type: 'answering' },
      { type: 'answered', result: answerOut({ index: 0, is_correct: false }) },
    );

    expect(state.phase === 'feedback' && state.session.rounds[0]).toMatchObject({
      answered: true,
      is_correct: false,
      correct_answer: { choice: 'dog' },
    });
  });

  it('resumes at the first unanswered round, or goes straight to completing', () => {
    const s = twoRounds();
    s.rounds[0]!.answered = true;
    expect(firstUnanswered(s)).toBe(1);
    expect(playerReducer({ phase: 'loading' }, { type: 'session', session: s })).toMatchObject({
      phase: 'round',
      index: 1,
    });

    s.rounds[1]!.answered = true;
    expect(playerReducer({ phase: 'loading' }, { type: 'session', session: s }).phase).toBe(
      'completing',
    );
  });

  it('shows results for a finished session and the intro for an abandoned one', () => {
    const s = twoRounds();
    expect(
      playerReducer({ phase: 'loading' }, { type: 'session', session: completed(s) }).phase,
    ).toBe('done');
    expect(
      playerReducer(
        { phase: 'loading' },
        { type: 'session', session: { ...s, status: 'abandoned' } },
      ).phase,
    ).toBe('intro');
  });

  it('keeps the round on screen with the error when an answer fails', () => {
    const error = new Error('offline');
    const state = play(
      { phase: 'intro' },
      { type: 'start' },
      { type: 'session', session: twoRounds() },
      { type: 'answering' },
      { type: 'answer-failed', error },
    );

    expect(state).toMatchObject({ phase: 'round', index: 0, error });
  });

  it('ignores actions that do not fit, so double taps cannot skip rounds', () => {
    const round = play(
      { phase: 'intro' },
      { type: 'start' },
      { type: 'session', session: twoRounds() },
    );

    // A second "answering" while checking, and a late answer for another round, change nothing.
    const checking = play(round, { type: 'answering' });
    expect(play(checking, { type: 'answering' })).toBe(checking);
    expect(play(checking, { type: 'answered', result: answerOut({ index: 1 }) })).toBe(checking);
    // "next" only works after feedback; "start" only from the intro or the results.
    expect(play(round, { type: 'next' })).toBe(round);
    expect(play(round, { type: 'start' })).toBe(round);
    // A failed completion that arrives after success doesn't undo the results.
    const done: PlayerState = { phase: 'done', session: completed(twoRounds()) };
    expect(play(done, { type: 'complete-failed', error: new Error('x') })).toBe(done);
  });

  it('lets a failed start or completion be tried again', () => {
    const error = new Error('down');
    expect(play({ phase: 'intro' }, { type: 'start' }, { type: 'start-failed', error })).toEqual({
      phase: 'intro',
      error,
    });

    const s = twoRounds();
    const failed = play({ phase: 'completing', session: s }, { type: 'complete-failed', error });
    expect(failed).toMatchObject({ phase: 'completing', error });
    expect(play(failed, { type: 'retry-complete' })).toEqual({ phase: 'completing', session: s });
  });
});
