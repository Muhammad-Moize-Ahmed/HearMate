import { screen, within } from '@testing-library/react';

import { CHILD, errorBody, mockApi, PARENT, tokenFor } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

async function signIn(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login', () => {
  it('has Parent, Child and Therapist tabs that work with the keyboard', async () => {
    mockApi({});
    const { user, router } = renderApp('/login');

    const parentTab = await screen.findByRole('tab', { name: /Parent/ });
    expect(parentTab).toHaveAttribute('aria-selected', 'true');

    parentTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /Child/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Child/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Child/);
    expect(router.state.location.search).toBe('?as=child');

    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('heading', { name: 'Therapist sign in' })).toBeInTheDocument();
  });

  it('checks the form before calling the server', async () => {
    const api = mockApi({});
    const { user } = renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Please enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Please enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('signs a parent in', async () => {
    const api = mockApi({ 'POST /api/auth/login': { body: tokenFor(PARENT) } });
    const { user, router } = renderApp('/login');

    await signIn(user, '  Sam@Example.com ', 'a-long-password');

    expect(await screen.findByRole('heading', { name: 'Hi, Sam!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
    expect(api.callsTo('POST /api/auth/login')[0]?.body).toEqual({
      email: 'Sam@Example.com',
      password: 'a-long-password',
    });
  });

  it('explains a wrong password', async () => {
    mockApi({ 'POST /api/auth/login': { status: 401, body: errorBody('invalid_credentials') } });
    const { user } = renderApp('/login');

    await signIn(user, 'sam@example.com', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That email and password don't match",
    );
  });

  it('says how long to wait after too many tries', async () => {
    mockApi({
      'POST /api/auth/login': {
        status: 429,
        body: errorBody('account_locked', 'Too many', { retry_after_seconds: 600 }),
      },
    });
    const { user } = renderApp('/login');

    await signIn(user, 'sam@example.com', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait 10 minutes');
  });

  it('sends an unverified account to enter its code, without asking for the password again', async () => {
    const api = mockApi({
      'POST /api/auth/login': { status: 403, body: errorBody('email_not_verified') },
      'POST /api/auth/verify-email': { body: tokenFor(PARENT) },
    });
    const { user, router } = renderApp('/login');

    await signIn(user, 'sam@example.com', 'a-long-password');
    await user.click(await screen.findByRole('link', { name: 'Enter your code' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Code from the email'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(await screen.findByRole('heading', { name: 'Hi, Sam!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
    expect(api.callsTo('POST /api/auth/verify-email')[0]?.body).toEqual({
      email: 'sam@example.com',
      code: '123456',
      password: 'a-long-password',
    });
  });

  it('shows a notice after a password reset, with the email filled in', async () => {
    mockApi({});
    renderApp('/login', { state: { notice: 'password-reset', email: 'sam@example.com' } });

    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
  });
});

describe('Child login', () => {
  it('lets a child sign in by tapping their PIN', async () => {
    const api = mockApi({ 'POST /api/auth/child-login': { body: tokenFor(CHILD) } });
    const { user, router } = renderApp('/login?as=child');

    await user.type(await screen.findByLabelText('Your name'), 'ali');
    const pad = screen.getByRole('group', { name: 'Number pad' });
    for (const digit of ['4', '8', '2', '7', '6']) {
      await user.click(within(pad).getByRole('button', { name: digit }));
    }
    await user.click(within(pad).getByRole('button', { name: 'Delete last number' }));
    expect(screen.getByLabelText('Your secret PIN')).toHaveValue('4827');

    await user.click(screen.getByRole('button', { name: /Let's go!/ }));

    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
    expect(api.callsTo('POST /api/auth/child-login')[0]?.body).toEqual({
      username: 'ali',
      pin: '4827',
    });
  });

  it('accepts typed digits only', async () => {
    mockApi({});
    const { user } = renderApp('/login?as=child');

    await user.type(await screen.findByLabelText('Your secret PIN'), '12a3x4');

    expect(screen.getByLabelText('Your secret PIN')).toHaveValue('1234');
  });

  it('gives a friendly message and clears the PIN when it is wrong', async () => {
    mockApi({
      'POST /api/auth/child-login': { status: 401, body: errorBody('invalid_credentials') },
    });
    const { user } = renderApp('/login?as=child');

    await user.type(await screen.findByLabelText('Your name'), 'ali');
    await user.type(screen.getByLabelText('Your secret PIN'), '1357');
    await user.click(screen.getByRole('button', { name: /Let's go!/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Hmm, that name or PIN isn't right");
    expect(screen.getByLabelText('Your secret PIN')).toHaveValue('');
  });
});
