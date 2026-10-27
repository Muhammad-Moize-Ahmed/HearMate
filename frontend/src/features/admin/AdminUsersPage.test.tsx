import { screen, within } from '@testing-library/react';

import { ADMIN, adminUserOut } from '../../test/careFixtures';
import { errorBody, mockApi, tokenFor, type RecordedCall } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const SAM = adminUserOut();
const SARA = adminUserOut({
  id: '22222222-2222-2222-2222-222222222222',
  email: 'sara@clinic.example',
  first_name: 'Sara',
  last_name: 'Khan',
  role: 'therapist',
  therapist_status: 'pending',
  children_count: null,
  email_verified: false,
  last_login_at: null,
});
const OFF = adminUserOut({
  id: '33333333-0000-0000-0000-000000000003',
  email: 'off@example.com',
  first_name: 'Old',
  last_name: 'Account',
  status: 'disabled',
  children_count: 0,
});

/** A fake `/admin/users` that filters a fixed list the way the server does. */
function usersEndpoint(all = [SAM, SARA, OFF]) {
  return ({ query }: RecordedCall) => {
    const q = (query.get('q') ?? '').toLowerCase();
    const matched = all.filter(
      (u) =>
        (!q || `${u.email} ${u.first_name} ${u.last_name}`.toLowerCase().includes(q)) &&
        (!query.get('role') || u.role === query.get('role')) &&
        (!query.get('status') || u.status === query.get('status')),
    );
    const limit = Number(query.get('limit'));
    const offset = Number(query.get('offset'));
    return {
      body: { items: matched.slice(offset, offset + limit), total: matched.length, limit, offset },
    };
  };
}

function mockUsersApi(routes: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'POST /api/auth/refresh': { body: tokenFor(ADMIN) },
    'GET /api/admin/users': usersEndpoint(),
    ...routes,
  });
}

const card = (name: string) => screen.getByRole('heading', { name }).closest('article')!;

describe('All accounts (admin)', () => {
  it('lists adult accounts with their role details', async () => {
    mockUsersApi();
    renderApp('/admin/users');

    expect(await screen.findByText('Showing 1–3 of 3 accounts')).toBeInTheDocument();
    expect(within(card('Sam Parent')).getByText('Parent')).toBeInTheDocument();
    expect(within(card('Sam Parent')).getByText('Children').nextElementSibling).toHaveTextContent(
      '2',
    );
    expect(within(card('Sara Khan')).getByText('Waiting')).toBeInTheDocument();
    expect(within(card('Sara Khan')).getByText('Email not verified')).toBeInTheDocument();
    expect(within(card('Sara Khan')).getByText('Never')).toBeInTheDocument();
    expect(within(card('Old Account')).getByText('Turned off')).toBeInTheDocument();
    // Read-only: nothing to press on an account.
    expect(within(card('Sam Parent')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('searches after typing stops, and filters by role and status, keeping all in the URL', async () => {
    const api = mockUsersApi();
    const { user, router } = renderApp('/admin/users');
    await screen.findByText('Showing 1–3 of 3 accounts');

    await user.type(screen.getByLabelText('Search'), 'khan');
    expect(await screen.findByText('Showing 1–1 of 1 account')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=khan');
    // Debounced: one request for the whole word, not one per letter.
    const searches = api.callsTo('GET /api/admin/users').map((c) => c.query.get('q'));
    expect(searches).toEqual([null, 'khan']);

    await user.clear(screen.getByLabelText('Search'));
    await user.click(screen.getByRole('radio', { name: 'Parents' }));
    await user.click(screen.getByRole('radio', { name: 'Turned off' }));

    expect(await screen.findByText('Showing 1–1 of 1 account')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Old Account' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?role=parent&status=disabled');
    const last = api.callsTo('GET /api/admin/users').at(-1)!.query;
    expect(last.get('role')).toBe('parent');
    expect(last.get('status')).toBe('disabled');
  });

  it('pages through long lists', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      adminUserOut({
        id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
        email: `p${i}@example.com`,
        first_name: 'Parent',
        last_name: String(i),
      }),
    );
    const api = mockUsersApi({ 'GET /api/admin/users': usersEndpoint(many) });
    const { user, router } = renderApp('/admin/users');

    expect(await screen.findByText('Showing 1–25 of 30 accounts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Newer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older →' }));

    expect(await screen.findByText('Showing 26–30 of 30 accounts')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?page=2');
    expect(api.callsTo('GET /api/admin/users').at(-1)!.query.get('offset')).toBe('25');
  });

  it('explains when nothing matches', async () => {
    mockUsersApi();
    renderApp('/admin/users?q=nobody');

    expect(await screen.findByText('No accounts match.')).toBeInTheDocument();
  });

  it('shows an error with a way to try again', async () => {
    mockUsersApi({
      'GET /api/admin/users': { status: 403, body: errorBody('forbidden', 'Admins only') },
    });
    renderApp('/admin/users');

    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is linked from the dashboard', async () => {
    mockUsersApi({
      'GET /api/admin/therapists': { body: [] },
      'GET /api/admin/stats': {
        body: {
          parents: 0,
          therapists: { total: 0, pending: 0, approved: 0, rejected: 0 },
          admins: 1,
          disabled_accounts: 0,
          children: 0,
          sessions_completed_last_7_days: 0,
          sessions_completed_last_30_days: 0,
        },
      },
    });
    const { user, router } = renderApp('/admin');

    await user.click(await screen.findByRole('link', { name: /All accounts/ }));
    expect(await screen.findByRole('heading', { name: 'All accounts' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/users');
  });
});
