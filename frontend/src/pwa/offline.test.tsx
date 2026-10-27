import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';

import { mockParentApi } from '../test/fixtures';
import { errorBody, mockApi, PARENT, tokenFor } from '../test/mockApi';
import { mockChildApi } from '../test/playFixtures';
import { renderApp } from '../test/renderApp';

const goOffline = () => act(() => onlineManager.setOnline(false));
const goOnline = () => act(() => onlineManager.setOnline(true));

describe('Offline indicator and adult pages', () => {
  it('tells a parent they are offline, then loads the page by itself when back online', async () => {
    const api = mockParentApi();
    onlineManager.setOnline(false);
    renderApp('/parent');

    expect(await screen.findByText(/You're offline\. This page will update/)).toBeInTheDocument();
    expect(api.callsTo('GET /api/children')).toHaveLength(0); // waits, rather than failing

    goOnline();
    expect(await screen.findByRole('link', { name: /Ali/ })).toBeInTheDocument();
    expect(screen.getByText('Back online')).toBeInTheDocument();
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it('uses child-friendly words in the play area', async () => {
    mockChildApi();
    renderApp('/play');
    await screen.findByRole('heading', { name: 'Hi Ali!' });

    goOffline();
    expect(screen.getByText(/No internet right now/)).toBeInTheDocument();
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it('fails a change straight away offline instead of queueing it for later', async () => {
    const api = mockParentApi({
      'POST /api/children': () => {
        throw new TypeError('Failed to fetch'); // what fetch does with no connection
      },
    });
    const { user } = renderApp('/parent/children/new');
    await user.type(await screen.findByLabelText('Name'), 'Zara');
    await user.type(screen.getByLabelText('Date of birth'), '2019-03-14');
    await user.click(screen.getByRole('checkbox', { name: /Telling similar sounds apart/ }));
    await user.click(screen.getByRole('radio', { name: '10 min' }));
    goOffline();

    await user.click(screen.getByRole('button', { name: 'Add Zara' }));
    expect(await screen.findByText(/couldn't reach HearMate/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/children')).toHaveLength(1);

    goOnline(); // nothing was queued, so nothing is sent behind the parent's back
    await act(async () => {});
    expect(api.callsTo('POST /api/children')).toHaveLength(1);
  });
});

describe('Opening the app offline', () => {
  it("keeps the sign-in and doesn't send the user to the login page", async () => {
    let online = false;
    const api = mockApi({
      'POST /api/auth/refresh': () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { body: tokenFor(PARENT) };
      },
      'GET /api/children': { body: [] },
      'GET /api/family/progress': { body: [] },
    });
    onlineManager.setOnline(false);
    const { router } = renderApp('/parent');

    await waitFor(() => expect(api.callsTo('POST /api/auth/refresh')).toHaveLength(1));
    expect(router.state.location.pathname).toBe('/parent');
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();

    online = true;
    goOnline();
    expect(
      await screen.findByRole('heading', { name: "Let's add your first child" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
  });
});

describe('Opening the app offline with a sign-in that has ended', () => {
  it('signs out as soon as the refresh fails back online, and clears cached data', async () => {
    let online = false;
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2-http://localhost:3000/', 'left-over-cache'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    const api = mockApi({
      'POST /api/auth/refresh': () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { status: 401, body: errorBody('invalid_token') }; // expired or revoked
      },
    });
    onlineManager.setOnline(false);
    const { router } = renderApp('/parent');

    await waitFor(() => expect(api.callsTo('POST /api/auth/refresh')).toHaveLength(1));
    expect(router.state.location.pathname).toBe('/parent'); // still waiting, not signed out yet
    await waitFor(() => expect(deleted).toEqual(['left-over-cache'])); // tidied up at start
    deleted.length = 0;

    online = true;
    goOnline();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(api.callsTo('POST /api/auth/refresh')).toHaveLength(2);
    await waitFor(() => expect(deleted).toEqual(['left-over-cache']));
    // Nothing about the family was requested on the way out.
    expect(api.calls.filter((c) => c.path !== '/api/auth/refresh')).toEqual([]);
  });
});

describe('Signing out', () => {
  it('deletes every cache except the build precache', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2-http://localhost:3000/', 'some-runtime-cache'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    mockParentApi({ 'POST /api/auth/logout': { status: 204 } });
    const { user } = renderApp('/parent');
    await screen.findByRole('link', { name: /Ali/ });
    deleted.length = 0; // the signed-out start already tidied up once

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(deleted).toEqual(['some-runtime-cache']));
  });
});
