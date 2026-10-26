import { screen } from '@testing-library/react';

import { CHILD, mockApi, PARENT, THERAPIST, tokenFor } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('route guards', () => {
  it('sends signed-out visitors to sign in, then back to where they were going', async () => {
    mockApi({ 'POST /api/auth/login': { body: tokenFor(PARENT) } });
    const { router, user } = renderApp('/parent');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');

    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Hi, Sam!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
  });

  it("opens the child's sign-in tab when a signed-out visitor asks for the play area", async () => {
    mockApi({});
    const { router } = renderApp('/play');

    expect(await screen.findByRole('heading', { name: "Let's play!" })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?as=child');
  });

  it('restores the sign-in from the cookie on page load', async () => {
    mockApi({ 'POST /api/auth/refresh': { body: tokenFor(THERAPIST) } });
    const { router } = renderApp('/therapist');

    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/therapist');
  });

  it('keeps each account in its own area', async () => {
    mockApi({ 'POST /api/auth/refresh': { body: tokenFor(CHILD) } });
    const { router } = renderApp('/parent');

    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
  });

  it('sends signed-in users away from the sign-in screens', async () => {
    mockApi({ 'POST /api/auth/refresh': { body: tokenFor(PARENT) } });
    const { router } = renderApp('/login');

    expect(await screen.findByRole('heading', { name: 'Hi, Sam!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
  });

  it('signs out: the server ends the session and the user goes back to sign in', async () => {
    const api = mockApi({
      'POST /api/auth/refresh': { body: tokenFor(PARENT) },
      'POST /api/auth/logout': { status: 204 },
    });
    const { router, user } = renderApp('/parent');

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/logout')).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/login');
  });
});
