import { screen, within } from '@testing-library/react';

import {
  APPROVED_THERAPIST,
  linkOut,
  mockTherapistApi,
  OTHER_CHILD_ID,
} from '../../test/careFixtures';
import { CHILD_ID } from '../../test/fixtures';
import { errorBody, mockApi, THERAPIST, tokenFor } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const INVITE = linkOut({
  id: 'aaaaaaaa-0000-0000-0000-000000000002',
  status: 'pending',
  accepted_at: null,
  child: { id: OTHER_CHILD_ID, display_name: 'Zara', age_years: 6, avatar: 'cat' },
  parent: { first_name: 'Nadia', last_name: 'Ahmed' },
});

describe('Therapist dashboard: waiting for approval', () => {
  it('shows the pending state and asks for no children or invitations', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': { body: tokenFor(THERAPIST) } });
    renderApp('/therapist');

    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Patients' })).not.toBeInTheDocument();
    expect(api.calls.filter((c) => /therapist\/links|children/.test(c.path))).toEqual([]);
  });

  it('checks again and opens the dashboard once approved', async () => {
    let refreshes = 0;
    const api = mockTherapistApi({
      'POST /api/auth/refresh': () => {
        refreshes += 1;
        return { body: tokenFor(refreshes === 1 ? THERAPIST : APPROVED_THERAPIST) };
      },
    });
    const { user } = renderApp('/therapist');

    await user.click(await screen.findByRole('button', { name: 'Check again' }));

    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ali/ })).toHaveAttribute(
      'href',
      `/therapist/children/${CHILD_ID}`,
    );
    expect(api.callsTo('GET /api/therapist/links')).toHaveLength(1);
  });

  it('shows why a rejected account was not approved, and checks again', async () => {
    const rejected = {
      ...THERAPIST,
      therapist_status: 'rejected',
      therapist_rejection_reason: 'Licence number not found.',
    };
    let refreshes = 0;
    const api = mockTherapistApi({
      'POST /api/auth/refresh': () => {
        refreshes += 1;
        return { body: tokenFor(refreshes <= 2 ? rejected : APPROVED_THERAPIST) };
      },
    });
    const { user } = renderApp('/therapist');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Your account wasn't approved");
    expect(alert).toHaveTextContent('Licence number not found.');
    expect(api.callsTo('GET /api/therapist/links')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Still not approved/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
  });
});

describe('Therapist dashboard: approved', () => {
  it('lists linked children as patients and invitations separately', async () => {
    mockTherapistApi({}, [linkOut(), INVITE]);
    renderApp('/therapist');

    const patients = (await screen.findByRole('heading', { name: 'Patients' })).closest('section')!;
    expect(within(patients).getByRole('link', { name: /Ali/ })).toBeInTheDocument();
    expect(within(patients).queryByText('Zara')).not.toBeInTheDocument();

    const invites = screen.getByRole('heading', { name: 'Invitations (1)' }).closest('section')!;
    expect(within(invites).getByText('Zara')).toBeInTheDocument();
    expect(within(invites).getByText(/invited by Nadia Ahmed/)).toBeInTheDocument();
  });

  it('accepts an invitation, which turns it into a patient', async () => {
    let accepted = false;
    const api = mockTherapistApi({
      'GET /api/therapist/links': () => ({
        body: [linkOut(), accepted ? { ...INVITE, status: 'active' } : INVITE],
      }),
      [`POST /api/therapist/links/${INVITE.id}/accept`]: () => {
        accepted = true;
        return { body: { ...INVITE, status: 'active' } };
      },
    });
    const { user } = renderApp('/therapist');

    await user.click(await screen.findByRole('button', { name: 'Accept invitation for Zara' }));

    expect(await screen.findByRole('link', { name: /Zara/ })).toHaveAttribute(
      'href',
      `/therapist/children/${OTHER_CHILD_ID}`,
    );
    expect(screen.queryByRole('heading', { name: /Invitations/ })).not.toBeInTheDocument();
    expect(api.callsTo(`POST /api/therapist/links/${INVITE.id}/accept`)).toHaveLength(1);
  });

  it('declines an invitation only after confirming', async () => {
    let declined = false;
    const api = mockTherapistApi({
      'GET /api/therapist/links': () => ({ body: declined ? [linkOut()] : [linkOut(), INVITE] }),
      [`DELETE /api/therapist/links/${INVITE.id}`]: () => {
        declined = true;
        return { status: 204 };
      },
    });
    const { user } = renderApp('/therapist');

    await user.click(await screen.findByRole('button', { name: 'Decline invitation for Zara' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(api.callsTo(`DELETE /api/therapist/links/${INVITE.id}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Decline invitation for Zara' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Decline' }),
    );

    await screen.findByRole('heading', { name: 'Patients' });
    expect(await screen.findByText('Patients')).toBeInTheDocument();
    expect(screen.queryByText('Zara')).not.toBeInTheDocument();
    expect(api.callsTo(`DELETE /api/therapist/links/${INVITE.id}`)).toHaveLength(1);
  });

  it('shows an empty state with no patients', async () => {
    mockTherapistApi({}, []);
    renderApp('/therapist');

    expect(await screen.findByText(/No patients yet/)).toBeInTheDocument();
  });

  it('offers to try again when the list cannot load', async () => {
    mockTherapistApi({
      'GET /api/therapist/links': { status: 403, body: errorBody('forbidden', 'Not allowed') },
    });
    renderApp('/therapist');

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
