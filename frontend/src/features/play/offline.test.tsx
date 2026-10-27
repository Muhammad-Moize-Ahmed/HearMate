import { onlineManager } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';

import { isGameActive } from '../../lib/gameActivity';
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

const goOffline = () => act(() => onlineManager.setOnline(false));
const goOnline = () => act(() => onlineManager.setOnline(true));

describe('Game player offline', () => {
  it("can't start a game offline: a friendly message instead of an error", async () => {
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: session('sound-detective', [prompt()]) },
    });
    renderApp('/play/games/sound-detective');
    await screen.findByRole('button', { name: /Start!/ });

    goOffline();
    expect(screen.queryByRole('button', { name: /Start!/ })).toBeNull();
    expect(screen.getByText(/We need the internet to play/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull(); // not an error

    goOnline();
    expect(screen.getByRole('button', { name: /Start!/ })).toBeInTheDocument();
    expect(api.callsTo('POST /api/sessions')).toHaveLength(0);
  });

  it('says so when a game is opened offline before anything has loaded', async () => {
    mockChildApi();
    onlineManager.setOnline(false);
    renderApp('/play/games/sound-detective');

    expect(await screen.findByText('We need the internet to play.')).toBeInTheDocument();
    goOnline();
    expect(await screen.findByRole('button', { name: /Start!/ })).toBeInTheDocument();
  });

  it('pauses when the connection drops mid-game, sends nothing, then carries on', async () => {
    const s = session('sound-detective', [prompt(), prompt({ instruction: 'Round two!' })]);
    const api = mockChildApi({
      'POST /api/sessions': { status: 201, body: s },
      [`GET ${SESSION}`]: { body: s },
      [`POST ${SESSION}/rounds/0/answer`]: { body: answerOut({ index: 0 }) },
    });
    const { user } = renderApp('/play/games/sound-detective');
    await user.click(await screen.findByRole('button', { name: /Start!/ }));
    await screen.findByRole('button', { name: /Dog barking/ });
    expect(isGameActive()).toBe(true);

    goOffline();
    expect(screen.getByText('Oops, the internet went away.')).toBeInTheDocument();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dog barking/ })).toBeNull();
    // The app-wide banner steps aside: the game shows its own message.
    expect(screen.queryByText(/No internet right now/)).toBeNull();

    goOnline();
    // The session is read again from the server (the resume path) before play continues.
    await user.click(await screen.findByRole('button', { name: /Dog barking/ }));
    expect(api.callsTo(`GET ${SESSION}`)).toHaveLength(1);
    expect(await screen.findByText('Yes! Well done!')).toBeInTheDocument();
    expect(api.callsTo(`POST ${SESSION}/rounds/0/answer`)).toHaveLength(1);
  });

  it('skips a round the server already got before the drop', async () => {
    const s = session('sound-detective', [prompt(), prompt({ instruction: 'Round two!' })]);
    const reRead = structuredClone(s);
    reRead.rounds[0]!.answered = true;
    mockChildApi({
      'POST /api/sessions': { status: 201, body: s },
      [`GET ${SESSION}`]: { body: reRead },
    });
    const { user } = renderApp('/play/games/sound-detective');
    await user.click(await screen.findByRole('button', { name: /Start!/ }));
    await screen.findByRole('button', { name: /Dog barking/ });

    goOffline();
    goOnline();

    expect(await screen.findByText('Round two!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Round 2 of 2' })).toBeInTheDocument();
  });

  it('waits for the connection before resuming a session from the URL', async () => {
    const s = session('sound-detective', [prompt()]);
    const api = mockChildApi({ [`GET ${SESSION}`]: { body: s } });
    onlineManager.setOnline(false);
    renderApp(`/play/games/sound-detective?session=${SESSION_ID}`);

    // Games aren't loaded yet either, so the child sees the friendly offline message.
    expect(await screen.findByText('We need the internet to play.')).toBeInTheDocument();
    expect(api.callsTo(`GET ${SESSION}`)).toHaveLength(0);

    goOnline();
    expect(await screen.findByRole('button', { name: /Dog barking/ })).toBeInTheDocument();
    expect(api.callsTo('POST /api/sessions')).toHaveLength(0); // the same session, not a new one
  });

  it('finishes the game once the connection is back if it dropped while saving', async () => {
    const s = session('sound-detective', [prompt()]);
    let completeCalls = 0;
    mockChildApi({
      'POST /api/sessions': { status: 201, body: s },
      [`POST ${SESSION}/rounds/0/answer`]: { body: answerOut({ index: 0, rounds_remaining: 0 }) },
      [`POST ${SESSION}/complete`]: () => {
        completeCalls += 1;
        if (completeCalls === 1) {
          onlineManager.setOnline(false);
          throw new TypeError('Failed to fetch');
        }
        return { body: completed(s) };
      },
    });
    const { user } = renderApp('/play/games/sound-detective');
    await user.click(await screen.findByRole('button', { name: /Start!/ }));
    await user.click(await screen.findByRole('button', { name: /Dog barking/ }));
    await user.click(await screen.findByRole('button', { name: /See my stars/ }));

    expect(await screen.findByText('Oops, the internet went away.')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't save your game.")).toBeNull();

    goOnline();
    expect(await screen.findByRole('heading', { name: 'Amazing!' })).toBeInTheDocument();
    expect(completeCalls).toBe(2);
    expect(isGameActive()).toBe(false);
  });
});
