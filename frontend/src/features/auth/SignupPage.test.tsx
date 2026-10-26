import { screen } from '@testing-library/react';

import { errorBody, mockApi, THERAPIST, tokenFor } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

type User = ReturnType<typeof renderApp>['user'];

async function fillAccount(user: User, { confirm = 'a-long-password' } = {}) {
  await user.type(await screen.findByLabelText('First name'), 'Sara');
  await user.type(screen.getByLabelText('Last name'), 'Khan');
  await user.type(screen.getByLabelText('Email'), 'sara@example.com');
  await user.type(screen.getByLabelText('Password'), 'a-long-password');
  await user.type(screen.getByLabelText('Type the password again'), confirm);
}

describe('Sign up', () => {
  it('checks the passwords before calling the server', async () => {
    const api = mockApi({});
    const { user } = renderApp('/signup');

    await user.type(await screen.findByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await fillAccount(user, { confirm: 'something-else' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/signup')).toHaveLength(0);
  });

  it('signs up a therapist, then verifies the email and lands on the therapist area', async () => {
    const api = mockApi({
      'POST /api/auth/signup': { status: 202, body: { message: 'Check your email to continue.' } },
      'POST /api/auth/verify-email': { body: tokenFor(THERAPIST) },
    });
    const { user, router } = renderApp('/signup');

    expect(screen.queryByLabelText('Organisation')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: /I'm a therapist/ }));
    await fillAccount(user);
    await user.type(screen.getByLabelText('Organisation'), 'City Clinic');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/signup')[0]?.body).toEqual({
      role: 'therapist',
      first_name: 'Sara',
      last_name: 'Khan',
      email: 'sara@example.com',
      password: 'a-long-password',
      therapist: { license_number: null, organization: 'City Clinic', specialization: null },
    });
    // The password is still in memory, so it isn't asked for again.
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Code from the email'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/therapist');
  });

  it('sends no therapist details for a parent', async () => {
    const api = mockApi({ 'POST /api/auth/signup': { status: 202, body: { message: 'ok' } } });
    const { user } = renderApp('/signup');

    await fillAccount(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByRole('heading', { name: 'Check your email' });
    const body = api.callsTo('POST /api/auth/signup')[0]?.body as Record<string, unknown>;
    expect(body.role).toBe('parent');
    expect(body).not.toHaveProperty('therapist');
  });
});

describe('Verify email', () => {
  it('asks for the password when it opens without one in memory (e.g. after a reload)', async () => {
    const api = mockApi({
      'POST /api/auth/verify-email': { status: 400, body: errorBody('invalid_code') },
    });
    const { user } = renderApp('/verify-email');

    await user.type(await screen.findByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('Code from the email'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(await screen.findByText('Please enter the password you chose.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/verify-email')).toHaveLength(0);

    await user.type(screen.getByLabelText('Your password'), 'a-long-password');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right");
  });

  it('can send a new code, then waits before allowing another', async () => {
    const api = mockApi({
      'POST /api/auth/resend-verification': { status: 202, body: { message: 'ok' } },
    });
    const { user } = renderApp('/verify-email', { state: { email: 'sam@example.com' } });

    await user.click(await screen.findByRole('button', { name: 'Send me a new code' }));

    expect(await screen.findByText(/a new code is on its way/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
    expect(api.callsTo('POST /api/auth/resend-verification')[0]?.body).toEqual({
      email: 'sam@example.com',
    });
  });
});
