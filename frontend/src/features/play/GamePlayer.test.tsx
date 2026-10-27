import { screen, within } from '@testing-library/react';

import { fakeMicrophone } from '../../test/browserAudio';
import { errorBody } from '../../test/mockApi';
import {
  answerOut,
  completed,
  mockChildApi,
  prompt,
  session,
  SESSION,
  SESSION_ID,
} from '../../test/playFixtures';
import { renderApp } from '../../test/renderApp';

type User = ReturnType<typeof renderApp>['user'];

/** Start the game from its intro screen. */
async function startGame(user: User) {
  await user.click(await screen.findByRole('button', { name: /Start!/ }));
}

describe('Game player: the shared shell', () => {
  it('plays a whole session and shows the results from the server', async () => {
    const s = session('sound-detective', [prompt(), prompt()]);
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: s },
      [`POST ${SESSION}/rounds/0/answer`]: { body: answerOut({ index: 0 }) },
      [`POST ${SESSION}/rounds/1/answer`]: { body: answerOut({ index: 1, rounds_remaining: 0 }) },
      [`POST ${SESSION}/complete`]: {
        body: completed(s, {
          new_achievements: [
            {
              code: 'first_game',
              title: 'First steps',
              description: 'Finished your first game.',
              icon: 'sparkles',
              unlocked_at: '2026-10-27T10:05:00Z',
            },
          ],
          goals_achieved: ['Listening week'],
        }),
      },
    });
    const { user, router } = renderApp('/play/games/sound-detective');

    expect(await screen.findByText('Level 2')).toBeInTheDocument();
    await startGame(user);
    expect(router.state.location.search).toBe(`?session=${SESSION_ID}`); // a reload can resume

    for (const round of [0, 1]) {
      expect(
        await screen.findByRole('img', { name: `Round ${round + 1} of 2` }),
      ).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: /Dog barking/ }));
      expect(await screen.findByText('Yes! Well done!')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: round === 0 ? /Next/ : /See my stars/ }));
    }

    expect(await screen.findByRole('heading', { name: 'Amazing!' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '3 out of 3 stars' })).toBeInTheDocument();
    expect(screen.getByText(/Level up!/).closest('p')).toHaveTextContent(
      "Level up! You're on level 3 now.",
    );
    expect(screen.getByText(/in a row!/).closest('p')).toHaveTextContent('4 days in a row!');
    expect(screen.getByText('New badge: First steps')).toBeInTheDocument();
    expect(screen.getByText(/Goal reached:/).closest('p')).toHaveTextContent(
      'Goal reached: Listening week',
    );

    // The client sent answers only: never a score or "correct" flag.
    const answers = api.calls.filter((c) => c.path.endsWith('/answer'));
    expect(answers.map((c) => Object.keys(c.body as object).sort())).toEqual([
      ['answer', 'response_time_ms'],
      ['answer', 'response_time_ms'],
    ]);
    expect(answers[0]?.body).toMatchObject({ answer: { choice: 'dog' } });
    expect(api.callsTo('POST /api/sessions')[0]?.body).toEqual({
      child_id: expect.any(String),
      game: 'sound-detective',
      with_noise: false,
    });
  });

  it('can add background noise to games that offer it', async () => {
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
    });
    const { user } = renderApp('/play/games/sound-detective');

    await user.click(await screen.findByRole('checkbox', { name: /Add background noise/ }));
    await startGame(user);

    await screen.findByRole('button', { name: /Dog barking/ });
    expect(api.callsTo('POST /api/sessions')[0]?.body).toMatchObject({ with_noise: true });
  });

  it('picks a session up again after a reload, at the first unanswered round', async () => {
    const s = session('sound-detective', [prompt(), prompt({ instruction: 'Round two!' })]);
    s.rounds[0]!.answered = true;
    const api = mockChildApi({ [`GET ${SESSION}`]: { body: s } });
    renderApp(`/play/games/sound-detective?session=${SESSION_ID}`);

    expect(await screen.findByText('Round two!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Round 2 of 2' })).toBeInTheDocument();
    expect(api.callsTo('POST /api/sessions')).toHaveLength(0);
  });

  it('starts fresh when the session in the URL belongs to another game', async () => {
    mockChildApi({ [`GET ${SESSION}`]: { body: session('word-sequence', [prompt()]) } });
    renderApp(`/play/games/sound-detective?session=${SESSION_ID}`);

    expect(await screen.findByRole('button', { name: /Start!/ })).toBeInTheDocument();
  });

  it('asks before stopping, then abandons the session', async () => {
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
    });
    const { user, router } = renderApp('/play/games/sound-detective');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: /Stop/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Stop this game?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stop playing' }));

    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
    expect(api.callsTo(`POST ${SESSION}/abandon`)).toHaveLength(1);
  });

  it('explains a missing sound file and lets the child pick another game', async () => {
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
      [`GET ${SESSION}/rounds/0/stimulus`]: {
        status: 503,
        body: errorBody('sound_unavailable', "This sound isn't installed yet"),
      },
    });
    const { user, router } = renderApp('/play/games/sound-detective');

    await startGame(user);

    expect(await screen.findByText("Oh no! This sound isn't ready yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dog barking/ })).not.toBeInTheDocument();
    expect(api.callsTo(`GET ${SESSION}/rounds/0/stimulus`)).toHaveLength(1); // not retried
    await user.click(screen.getByRole('button', { name: 'Choose another game' }));
    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
    expect(api.callsTo(`POST ${SESSION}/abandon`)).toHaveLength(1);
  });

  it('keeps the round when an answer fails to send, so it can be tried again', async () => {
    let attempts = 0;
    mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
      [`POST ${SESSION}/rounds/0/answer`]: () =>
        ++attempts === 1
          ? { status: 500, body: errorBody('internal_error') }
          : { body: answerOut({ rounds_remaining: 0 }) },
    });
    const { user } = renderApp('/play/games/sound-detective');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: /Dog barking/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');

    await user.click(screen.getByRole('button', { name: /Dog barking/ }));
    expect(await screen.findByText('Yes! Well done!')).toBeInTheDocument();
  });

  it('offers to try again if the results fail to save', async () => {
    const s = session('sound-detective', [prompt()]);
    let attempts = 0;
    mockChildApi({
      'POST /api/sessions': { status: 201, body: s },
      [`POST ${SESSION}/rounds/0/answer`]: { body: answerOut({ rounds_remaining: 0 }) },
      [`POST ${SESSION}/complete`]: () =>
        ++attempts === 1 ? { status: 503, body: errorBody('unavailable') } : { body: completed(s) },
    });
    const { user } = renderApp('/play/games/sound-detective');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: /Dog barking/ }));
    await user.click(await screen.findByRole('button', { name: /See my stars/ }));
    expect(await screen.findByText("We couldn't save your game.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Amazing!' })).toBeInTheDocument();
  });

  it("explains a game that doesn't exist", async () => {
    mockChildApi();
    renderApp('/play/games/no-such-game');

    expect(await screen.findByText("We can't find that game.")).toBeInTheDocument();
  });
});

describe('Sound Detective', () => {
  it('shows a picture for each sound and says what it was after a wrong answer', async () => {
    mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
      [`POST ${SESSION}/rounds/0/answer`]: {
        body: answerOut({ is_correct: false, score: 0, correct_answer: { choice: 'dog' } }),
      },
    });
    const { user } = renderApp('/play/games/sound-detective');

    await startGame(user);
    const cat = await screen.findByRole('button', { name: /Cat meowing/ });
    expect(cat).toHaveTextContent('🐱');
    await user.click(cat);

    expect(await screen.findByText('Nice try!')).toBeInTheDocument();
    expect(screen.getByText(/It was/)).toHaveTextContent('It was 🐶 Dog barking');
  });
});

describe('Similar Sounds', () => {
  it('answers with the chosen word', async () => {
    const words = prompt({
      instruction: 'Which word did you hear?',
      stimulus: { type: 'speech', audio_url: `${SESSION}/rounds/0/stimulus` },
      options: [
        { id: 'pea', label: 'pea' },
        { id: 'bee', label: 'bee' },
      ],
    });
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('similar-sounds', [words]) },
      [`POST ${SESSION}/rounds/0/answer`]: {
        body: answerOut({
          is_correct: false,
          correct_answer: { choice: 'bee', contrast: 'p/b' },
          feedback: { contrast: 'p/b' },
        }),
      },
    });
    const { user } = renderApp('/play/games/similar-sounds');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: 'pea' }));

    expect(await screen.findByText(/It was/)).toHaveTextContent('It was bee');
    expect(api.callsTo(`POST ${SESSION}/rounds/0/answer`)[0]?.body).toMatchObject({
      answer: { choice: 'pea' },
    });
  });
});

describe('Word Sequence', () => {
  const words = prompt({
    instruction: 'Tap the words in the order you heard them.',
    stimulus: { type: 'speech_sequence', audio_url: `${SESSION}/rounds/0/stimulus` },
    options: ['sun', 'cat', 'boat', 'tree'].map((w) => ({ id: w, label: w })),
    answer_length: 2,
  });

  it('taps words into slots, can undo, and sends the order', async () => {
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('word-sequence', [words]) },
      [`POST ${SESSION}/rounds/0/answer`]: {
        body: answerOut({
          is_correct: false,
          score: 50,
          correct_answer: { sequence: ['cat', 'sun'] },
          feedback: { in_place: 1, length: 2 },
        }),
      },
    });
    const { user } = renderApp('/play/games/word-sequence');

    await startGame(user);
    const slots = await screen.findByRole('list', { name: 'Your order' });
    expect(within(slots).getAllByRole('listitem')).toHaveLength(2);
    const done = screen.getByRole('button', { name: 'Done!' });
    expect(done).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'tree' }));
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await user.click(screen.getByRole('button', { name: 'boat' }));
    expect(screen.getByRole('button', { name: 'boat' })).toBeDisabled(); // each word once
    await user.click(screen.getByRole('button', { name: 'sun' }));
    expect(screen.getByRole('button', { name: 'cat' })).toBeDisabled(); // all slots full
    await user.click(done);

    expect(await screen.findByText('1 of 2 in the right place.')).toBeInTheDocument();
    const order = screen.getByText('The order was:').nextElementSibling as HTMLElement;
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['cat', 'sun']);
    expect(api.callsTo(`POST ${SESSION}/rounds/0/answer`)[0]?.body).toMatchObject({
      answer: { sequence: ['boat', 'sun'] },
    });
  });
});

describe('Listening in Noise', () => {
  it('shows that the round is noisy and takes a choice', async () => {
    const noisy = prompt({
      stimulus: { type: 'speech', audio_url: `${SESSION}/rounds/0/stimulus` },
      options: [
        { id: 'ship', label: 'ship' },
        { id: 'fish', label: 'fish' },
        { id: 'dish', label: 'dish' },
      ],
      noise: { kind: 'white', snr_db: 20 },
    });
    mockChildApi({
      'POST /api/sessions': { status: 201, body: session('listening-in-noise', [noisy]) },
      [`POST ${SESSION}/rounds/0/answer`]: {
        body: answerOut({ correct_answer: { choice: 'fish' }, rounds_remaining: 0 }),
      },
    });
    const { user } = renderApp('/play/games/listening-in-noise');

    expect(await screen.findByText(/There's background noise/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); // noise is always on
    await startGame(user);
    expect(await screen.findByText('Noisy round')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'fish' }));

    expect(await screen.findByText('Yes! Well done!')).toBeInTheDocument();
  });
});

describe('Speech Practice', () => {
  const say = prompt({
    instruction: 'Listen, then say it out loud.',
    stimulus: { type: 'speech', audio_url: `${SESSION}/rounds/0/stimulus` },
    options: [],
    display_text: 'three',
  });

  it('records the answer, sends the audio, and shows what was heard', async () => {
    const mic = fakeMicrophone('allow');
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('speech-practice', [say]) },
      [`POST ${SESSION}/rounds/0/speech`]: {
        body: answerOut({
          is_correct: false,
          score: 60,
          correct_answer: { text: 'three' },
          feedback: {
            score: 60,
            heard: 'tree',
            words: [{ expected: 'three', heard: 'tree', score: 60, missed_sounds: ['TH'] }],
            practise_sounds: ['TH'],
          },
        }),
      },
    });
    const { user } = renderApp('/play/games/speech-practice');

    expect(await screen.findByText(/You'll need the microphone/)).toBeInTheDocument();
    await startGame(user);
    expect(await screen.findByText('three')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record your answer' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));

    expect(await screen.findByText(/I heard:/)).toHaveTextContent('I heard: “tree”');
    expect(screen.getByText(/Let's practise the/)).toHaveTextContent(
      "Let's practise the “th” sound.",
    );
    expect(mic.track.stop).toHaveBeenCalled(); // the microphone is switched off again

    const upload = api.callsTo(`POST ${SESSION}/rounds/0/speech`)[0]!;
    expect(upload.headers.get('Content-Type')).toBe('audio/webm;codecs=opus');
    expect(upload.body).toBe('fake-audio');
    expect(api.calls.some((c) => c.path.endsWith('/answer'))).toBe(false);
  });

  it('explains when the microphone is not allowed and offers another game', async () => {
    fakeMicrophone('NotAllowedError');
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('speech-practice', [say]) },
    });
    const { user, router } = renderApp('/play/games/speech-practice');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: 'Record your answer' }));

    expect(await screen.findByText("We can't hear you yet.")).toBeInTheDocument();
    expect(screen.getByText(/allow the microphone/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another game' }));
    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
    expect(api.callsTo(`POST ${SESSION}/abandon`)).toHaveLength(1);
    expect(api.calls.some((c) => c.path.endsWith('/speech'))).toBe(false);
  });

  it('says when no microphone is found', async () => {
    fakeMicrophone('NotFoundError');
    mockChildApi({
      'POST /api/sessions': { status: 201, body: session('speech-practice', [say]) },
    });
    const { user } = renderApp('/play/games/speech-practice');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: 'Record your answer' }));

    expect(await screen.findByText("We can't find a microphone.")).toBeInTheDocument();
  });

  it('asks the child to try again when the recording was empty', async () => {
    fakeMicrophone('allow');
    mockChildApi({
      'POST /api/sessions': { status: 201, body: session('speech-practice', [say]) },
      [`POST ${SESSION}/rounds/0/speech`]: { status: 422, body: errorBody('invalid_audio') },
    });
    const { user } = renderApp('/play/games/speech-practice');

    await startGame(user);
    await user.click(await screen.findByRole('button', { name: 'Record your answer' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't hear that");
    expect(screen.getByRole('button', { name: 'Record your answer' })).toBeInTheDocument();
  });

  it("doesn't start when the server can't recognise speech", async () => {
    mockChildApi({
      'GET /api/speech/status': {
        body: { stt: { provider: null, available: false }, tts: { voice: null, available: true } },
      },
    });
    renderApp('/play/games/speech-practice');

    expect(await screen.findByText(/Speaking games aren't ready yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start!/ })).not.toBeInTheDocument();
  });
});
