import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { setGameActive } from '../lib/gameActivity';
import { UpdatePrompt } from './UpdatePrompt';
import { createUpdates } from './updates';

function setup({ busy = () => false }: { busy?: () => boolean } = {}) {
  const reload = vi.fn();
  const activate = vi.fn();
  const store = createUpdates({ reload, isBusy: busy });
  store.connect(activate);
  return { store, reload, activate };
}

describe('Updates', () => {
  it('says a new version is ready, and reloads only after Refresh lets it take over', async () => {
    const { store, reload, activate } = setup();
    render(<UpdatePrompt store={store} />);
    expect(screen.queryByText('A new version is ready')).not.toBeInTheDocument();

    act(() => store.waiting());
    expect(screen.getByText('A new version is ready')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(activate).toHaveBeenCalledOnce(); // the waiting worker is told to take over…
    expect(reload).not.toHaveBeenCalled();

    act(() => store.tookOver()); // …and once it has, the page reloads
    expect(reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload when another tab applies the update; it asks instead", async () => {
    const { store, reload } = setup();
    render(<UpdatePrompt store={store} />);

    act(() => store.tookOver());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('A new version is ready')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('never reloads in the middle of a game, and hides the prompt until the game is over', () => {
    const { store, reload, activate } = setup({ busy: () => true });
    render(<UpdatePrompt store={store} />);
    act(() => {
      setGameActive(true);
      store.waiting();
    });
    expect(screen.queryByText('A new version is ready')).not.toBeInTheDocument();

    store.apply();
    act(() => store.tookOver());
    expect(activate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    act(() => setGameActive(false));
    expect(screen.getByText('A new version is ready')).toBeInTheDocument();
  });

  it('does not reload if a game started between Refresh and the switch-over', () => {
    let busy = false;
    const { store, reload } = setup({ busy: () => busy });
    store.waiting();
    store.apply();
    busy = true;
    store.tookOver();
    expect(reload).not.toHaveBeenCalled();
    expect(store.isReady()).toBe(true);
  });

  it('"Later" hides the prompt until the next version', async () => {
    const { store } = setup();
    render(<UpdatePrompt store={store} />);
    act(() => store.waiting());

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version is ready')).not.toBeInTheDocument();

    act(() => store.waiting());
    expect(screen.getByText('A new version is ready')).toBeInTheDocument();
  });
});
