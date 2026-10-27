import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';

import { getEndReason, getSession } from '../../auth/session';
import { ADMIN, APPROVED_THERAPIST, statsOut } from '../../test/careFixtures';
import { mockParentApi } from '../../test/fixtures';
import { errorBody, mockApi, tokenFor } from '../../test/mockApi';
import { mockChildApi } from '../../test/playFixtures';
import { renderApp } from '../../test/renderApp';

type User = ReturnType<typeof renderApp>['user'];

const PARENT_SUMMARY = {
  role: 'parent',
  children: ['Ali', 'Zara'],
  games_played: 12,
  therapists: 1,
};
const THERAPIST_SUMMARY = { role: 'therapist', linked_children: 3, notes: 4, learning_plans: 1 };

/** Every cache name the page asks Cache Storage to delete. */
function watchCaches(): string[] {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: async () => ['workbox-precache-v2-http://localhost:3000/', 'left-over-cache'],
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    },
  });
  return deleted;
}

async function confirmWith(user: User, password: string) {
  await user.click(await screen.findByLabelText('I understand that this is permanent.'));
  await user.type(screen.getByLabelText('Your password'), password);
}

describe('Account page', () => {
  it('is linked from the header and shows who is signed in', async () => {
    mockParentApi();
    const { user, router } = renderApp('/parent');

    await user.click(await screen.findByRole('link', { name: 'Account' }));

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent/account');
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Delete my account…' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/account/delete'));
  });

  it('is not offered to admins, and a child is sent back to play', async () => {
    mockApi({
      'POST /api/auth/refresh': { body: tokenFor(ADMIN) },
      'GET /api/admin/therapists': { body: [] },
      'GET /api/admin/stats': { body: statsOut() },
    });
    const { router } = renderApp('/parent/account');

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('never lets a child open it', async () => {
    mockChildApi();
    const { router } = renderApp('/therapist/account/delete');

    await waitFor(() => expect(router.state.location.pathname).toBe('/play'));
  });
});

describe('Deleting a parent account', () => {
  it('says what goes and waits for "I understand" and the password', async () => {
    const api = mockParentApi({ 'GET /api/account/deletion-summary': { body: PARENT_SUMMARY } });
    const { user } = renderApp('/parent/account/delete');

    expect(await screen.findByText(/2 child profiles: Ali, Zara/)).toBeInTheDocument();
    expect(screen.getByText(/12 games played/)).toBeInTheDocument();
    expect(screen.getByText(/1 therapist loses access/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Delete my account forever' });
    expect(button).toBeDisabled();

    await user.click(screen.getByLabelText('I understand that this is permanent.'));
    expect(button).toBeDisabled(); // still needs the password
    await user.type(screen.getByLabelText('Your password'), 'a-long-password');
    expect(button).toBeEnabled();
    expect(api.callsTo('POST /api/account/delete')).toHaveLength(0);
  });

  it('keeps everything when the password is wrong', async () => {
    const api = mockParentApi({
      'GET /api/account/deletion-summary': { body: PARENT_SUMMARY },
      'POST /api/account/delete': { status: 403, body: errorBody('wrong_password') },
    });
    const { user, router } = renderApp('/parent/account/delete');

    await confirmWith(user, 'not-my-password');
    await user.click(screen.getByRole('button', { name: 'Delete my account forever' }));

    expect(
      await screen.findByText("That password isn't right. Nothing has been deleted."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent/account/delete');
    expect(getSession()).not.toBeNull(); // still signed in
    expect(api.callsTo('POST /api/account/delete')).toHaveLength(1); // a 403 is not retried
  });

  it('signs out and leaves nothing on the device once the account is deleted', async () => {
    const deleted = watchCaches();
    const api = mockParentApi({
      'GET /api/account/deletion-summary': { body: PARENT_SUMMARY },
      'POST /api/account/delete': { status: 204 },
    });
    const { user, router, queryClient } = renderApp('/parent/account/delete');

    await confirmWith(user, 'a-long-password');
    deleted.length = 0;
    await user.click(screen.getByRole('button', { name: 'Delete my account forever' }));

    expect(
      await screen.findByRole('heading', { name: 'Your account was deleted' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account-deleted');
    expect(api.callsTo('POST /api/account/delete')[0]?.body).toEqual({
      password: 'a-long-password',
    });
    expect(getSession()).toBeNull();
    expect(getEndReason()).toBe('deleted');
    await waitFor(() => expect(deleted).toEqual(['left-over-cache']));
    expect(queryClient.getQueryCache().getAll()).toEqual([]);

    // The parent's pages are gone with the session.
    await router.navigate('/parent');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it("can't be sent offline, so nothing is queued for later", async () => {
    const api = mockParentApi({ 'GET /api/account/deletion-summary': { body: PARENT_SUMMARY } });
    const { user } = renderApp('/parent/account/delete');

    await confirmWith(user, 'a-long-password');
    onlineManager.setOnline(false);

    expect(
      await screen.findByText('You need the internet to do this. Nothing has been deleted.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete my account forever' })).toBeDisabled();
    expect(api.callsTo('POST /api/account/delete')).toHaveLength(0);
  });
});

describe('Deleting a therapist account', () => {
  it('says what ends and what stays with the children, then deletes', async () => {
    const api = mockApi({
      'POST /api/auth/refresh': { body: tokenFor(APPROVED_THERAPIST) },
      'GET /api/account/deletion-summary': { body: THERAPIST_SUMMARY },
      'POST /api/account/delete': { status: 204 },
    });
    const { user, router } = renderApp('/therapist/account/delete');

    expect(await screen.findByText(/ends your access to 3 children/)).toBeInTheDocument();
    expect(screen.getByText(/keeps 4 notes and 1 learning plan you wrote/)).toBeInTheDocument();
    await confirmWith(user, 'a-long-password');
    await user.click(screen.getByRole('button', { name: 'Delete my account forever' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/account-deleted'));
    expect(api.callsTo('POST /api/account/delete')).toHaveLength(1);
    expect(getSession()).toBeNull();
  });
});

describe('The goodbye page', () => {
  it('does not sign out someone who just opens its address', async () => {
    mockParentApi();
    renderApp('/account-deleted');

    expect(
      await screen.findByRole('heading', { name: 'Your account was deleted' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(getSession()).not.toBeNull());
    expect(getEndReason()).toBe('signed-out');
  });
});
