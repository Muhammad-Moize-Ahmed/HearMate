import { screen, within } from '@testing-library/react';

import { ADMIN, APPROVED_THERAPIST, statsOut, therapistOut } from '../../test/careFixtures';
import { CHILD, errorBody, mockApi, PARENT, THERAPIST, tokenFor } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const PENDING = therapistOut();
const APPROVED = therapistOut({
  id: '22222222-0000-0000-0000-000000000002',
  email: 'omar@speech.example',
  first_name: 'Omar',
  last_name: 'Raza',
  organization: 'Speech Hub',
  approval_status: 'approved',
  reviewed_at: '2026-10-21T10:00:00Z',
});
const REJECTED = therapistOut({
  id: '22222222-0000-0000-0000-000000000003',
  email: 'lena@example.com',
  first_name: 'Lena',
  last_name: 'Malik',
  organization: null,
  approval_status: 'rejected',
  rejection_reason: 'Licence number not found.',
  reviewed_at: '2026-10-22T10:00:00Z',
});

/** A signed-in admin. Approve and reject change the account, so refetches see the decision. */
function mockAdminApi(routes: Parameters<typeof mockApi>[0] = {}) {
  let accounts = [PENDING, APPROVED, REJECTED];
  const decide = (id: string, change: Partial<typeof PENDING>) => {
    accounts = accounts.map((t) => (t.id === id ? { ...t, ...change } : t));
    return { body: accounts.find((t) => t.id === id) };
  };
  return mockApi({
    'POST /api/auth/refresh': { body: tokenFor(ADMIN) },
    'GET /api/admin/therapists': () => ({ body: accounts }),
    'GET /api/admin/stats': { body: statsOut() },
    [`POST /api/admin/therapists/${PENDING.id}/approve`]: () =>
      decide(PENDING.id, { approval_status: 'approved' }),
    [`POST /api/admin/therapists/${PENDING.id}/reject`]: ({ body }) =>
      decide(PENDING.id, {
        approval_status: 'rejected',
        rejection_reason: (body as { reason: string }).reason,
      }),
    ...routes,
  });
}

const countOf = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
const pendingSection = () =>
  screen.getByRole('heading', { name: 'Waiting for approval' }).closest('section')!;
const accountList = () =>
  screen.getByRole('heading', { name: 'Therapist accounts' }).closest('section')!;
/** Wait for the therapist list (the counts load separately). */
const loaded = () => screen.findByRole('heading', { name: 'Therapist accounts' });

describe('Admin dashboard', () => {
  it('shows counts and the therapists waiting for approval', async () => {
    mockAdminApi();
    renderApp('/admin');

    expect(await screen.findByText('Therapists', { selector: 'dt' })).toBeInTheDocument();
    expect(countOf('Parents')).toBe('12');
    expect(countOf('Children')).toBe('17');
    expect(countOf('Therapists')).toBe('3');
    expect(screen.getByText('1 approved · 1 not approved')).toBeInTheDocument();
    expect(countOf('Waiting for approval')).toBe('1');
    expect(countOf('Games, last 7 days')).toBe('40');
    expect(countOf('Games, last 30 days')).toBe('150');
    expect(countOf('Turned-off accounts')).toBe('2');

    await loaded();

    const pending = pendingSection();
    expect(within(pending).getByText('Sara Khan')).toBeInTheDocument();
    expect(within(pending).getByText('PK-123')).toBeInTheDocument();
    expect(within(pending).queryByText('Omar Raza')).not.toBeInTheDocument();
  });

  it('approves a therapist', async () => {
    const api = mockAdminApi();
    const { user } = renderApp('/admin');

    await loaded();
    await user.click(within(pendingSection()).getByRole('button', { name: 'Approve Sara Khan' }));

    expect(api.callsTo(`POST /api/admin/therapists/${PENDING.id}/approve`)).toHaveLength(1);
    expect(await within(pendingSection()).findByText(/Nothing to review/)).toBeInTheDocument();
  });

  it('rejects only with a reason, after confirming', async () => {
    const api = mockAdminApi();
    const { user } = renderApp('/admin');

    await loaded();
    await user.click(within(pendingSection()).getByRole('button', { name: 'Reject Sara Khan' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Reject Sara Khan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(within(pendingSection()).getByRole('button', { name: 'Reject Sara Khan' }));
    dialog = screen.getByRole('alertdialog', { name: 'Reject Sara Khan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject account' }));
    expect(within(dialog).getByText(/Give a reason/)).toBeInTheDocument();
    expect(api.callsTo(`POST /api/admin/therapists/${PENDING.id}/reject`)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Reason'), '  Please add your licence.  ');
    await user.click(within(dialog).getByRole('button', { name: 'Reject account' }));

    expect(await within(pendingSection()).findByText(/Nothing to review/)).toBeInTheDocument();
    expect(
      api.callsTo(`POST /api/admin/therapists/${PENDING.id}/reject`).map((c) => c.body),
    ).toEqual([{ reason: 'Please add your licence.' }]);
  });

  it('searches and filters the account list, keeping both in the URL', async () => {
    mockAdminApi();
    const { user, router } = renderApp('/admin');

    await loaded();
    const list = accountList();
    expect(within(list).getByText('3 accounts')).toBeInTheDocument();

    await user.type(within(list).getByLabelText('Search'), 'speech hub');
    expect(within(list).getByText('1 account')).toBeInTheDocument();
    expect(within(list).getByText('Omar Raza')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=speech+hub');

    await user.clear(within(list).getByLabelText('Search'));
    await user.click(within(list).getByRole('radio', { name: 'Not approved' }));
    expect(within(list).getByText('Lena Malik')).toBeInTheDocument();
    expect(within(list).getByText('Licence number not found.')).toBeInTheDocument();
    expect(within(list).queryByText('Sara Khan')).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?status=rejected');

    await user.type(within(list).getByLabelText('Search'), 'nobody');
    expect(within(list).getByText(/No accounts match/)).toBeInTheDocument();
  });

  it('reads filters from the URL', async () => {
    mockAdminApi();
    renderApp('/admin?status=approved');

    await loaded();
    expect(within(accountList()).getByText('1 account')).toBeInTheDocument();
    expect(within(accountList()).getByText('Omar Raza')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Approved' })).toBeChecked();
  });

  it('shows an error with a way to try again', async () => {
    mockAdminApi({
      'GET /api/admin/therapists': { status: 403, body: errorBody('forbidden', 'Admins only') },
    });
    renderApp('/admin');

    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('still works when the counts cannot load', async () => {
    mockAdminApi({
      'GET /api/admin/stats': { status: 403, body: errorBody('forbidden', 'No counts') },
    });
    renderApp('/admin');

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the counts");
    expect(await loaded()).toBeInTheDocument();
    expect(within(pendingSection()).getByText('Sara Khan')).toBeInTheDocument();
  });
});

const NON_ADMINS = [
  ['a parent', PARENT, '/parent', /Hi, Sam!/],
  ['an approved therapist', APPROVED_THERAPIST, '/therapist', /Hi, Sara!/],
  ['a therapist waiting for approval', THERAPIST, '/therapist', /Hi, Sara!/],
  ['a child', CHILD, '/play', /Hi Ali!/],
] as const;
const ADMIN_PATHS = ['/admin?status=pending', '/admin/users?role=parent'];

describe('Admin routes', () => {
  it.each(
    NON_ADMINS.flatMap(([who, principal, home, greeting]) =>
      ADMIN_PATHS.map((path) => [who, path, principal, home, greeting] as const),
    ),
  )(
    'keep %s out of %s and never call the admin API',
    async (_, path, principal, home, greeting) => {
      const api = mockApi({
        'POST /api/auth/refresh': { body: tokenFor(principal) },
        // Whatever the home page asks for; the admin API is deliberately not mocked.
        'GET /api/children': { body: [] },
        'GET /api/family/progress': { body: [] },
        'GET /api/therapist/links': { body: [] },
        'GET /api/games': { body: [] },
        [`GET /api/children/${CHILD.id}/levels`]: { body: [] },
        'GET /api/speech/status': {
          body: {
            stt: { provider: 'none', available: false },
            tts: { voice: '', available: false },
          },
        },
      });
      const { router } = renderApp(path);

      expect(await screen.findByRole('heading', { name: greeting })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(home);
      expect(api.calls.filter((c) => c.path.startsWith('/api/admin'))).toEqual([]);
    },
  );

  it('sends a signed-out visitor to sign in', async () => {
    const api = mockApi({});
    const { router } = renderApp('/admin');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(api.calls.filter((c) => c.path.startsWith('/api/admin'))).toEqual([]);
  });
});
