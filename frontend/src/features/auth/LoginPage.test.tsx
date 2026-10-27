import { screen, within } from '@testing-library/react';

import { CHILD, errorBody, mockApi, PARENT, THERAPIST, tokenFor } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

async function signIn(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login', () => {
  it('has a shared "Parent or therapist" tab and a Child tab that work with the keyboard', async () => {
    mockApi({});
    const { user, router } = renderApp('/login');

    expect(await screen.findAllByRole('tab')).toHaveLength(2);
    const adultTab = screen.getByRole('tab', { name: /Parent or therapist/ });
    expect(adultTab).toHaveAttribute('aria-selected', 'true');

    adultTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /Child/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Child/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Child/);
    expect(router.state.location.search).toBe('?as=child');

    await user.keyboard('{ArrowRight}'); // wraps around
    expect(adultTab).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.search).toBe('');
  });

  it('keeps /login?as=therapist: the same form, with therapist wording and sign-up link', async () => {
    mockApi({});
    const { user, router } = renderApp('/login?as=therapist');

    expect(
      await screen.findByText('Sign in to see the children you work with.'),
    ).toBeInTheDocument();
    const adultTab = screen.getByRole('tab', { name: /Parent or therapist/ });
    expect(adultTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup?role=therapist',
    );

    await user.click(adultTab); // choosing the current tab again keeps the wording
    expect(router.state.location.search).toBe('?as=therapist');
  });

  it('opens a parent account from the therapist wording without mentioning its role', async () => {
    const api = mockApi({ 'POST /api/auth/login': { body: tokenFor(PARENT) } });
    const { user, router } = renderApp('/login?as=therapist');

    await signIn(user, 'sam@example.com', 'a-long-password');

    expect(await screen.findByRole('heading', { name: 'Hi, Sam!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
    expect(screen.queryByText(/not a therapist/i)).not.toBeInTheDocument();
    // The request is the same as from the parent wording: no role is asked for.
    expect(api.callsTo('POST /api/auth/login')[0]?.body).toEqual({
      email: 'sam@example.com',
      password: 'a-long-password',
    });
  });

  it('opens a therapist account from the plain form', async () => {
    mockApi({ 'POST /api/auth/login': { body: tokenFor(THERAPIST) } });
    const { user, router } = renderApp('/login');

    await signIn(user, 'sara@example.com', 'a-long-password');

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/therapist'));
  });

  it('gives the same wrong-password message for either wording', async () => {
    for (const path of ['/login', '/login?as=therapist']) {
      mockApi({ 'POST /api/auth/login': { status: 401, body: errorBody('invalid_credentials') } });
      const { user, unmount } = renderApp(path);

      await signIn(user, 'sam@example.com', 'wrong-password');

      expect(
        await screen.findByText(
          "That email and password don't match. Please check them and try again.",
        ),
      ).toBeInTheDocument();
      unmount();
    }
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

  it('can show the password while typing it', async () => {
    mockApi({});
    const { user } = renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Show password' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
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
