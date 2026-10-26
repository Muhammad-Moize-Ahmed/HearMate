import { screen } from '@testing-library/react';

import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

describe('Forgot password', () => {
  it('emails a code, sets a new password, then returns to sign in', async () => {
    let attempts = 0;
    const api = mockApi({
      'POST /api/auth/password/forgot': { status: 202, body: { message: 'ok' } },
      'POST /api/auth/password/reset': () =>
        ++attempts === 1 ? { status: 400, body: errorBody('invalid_code') } : { status: 204 },
    });
    const { user, router } = renderApp('/forgot-password');

    await user.type(await screen.findByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));

    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code from the email'), '000000');
    await user.type(screen.getByLabelText('New password'), 'my-new-password');
    await user.type(screen.getByLabelText('Type it again'), 'my-new-password');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right");

    await user.clear(screen.getByLabelText('Code from the email'));
    await user.type(screen.getByLabelText('Code from the email'), '123456');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
    expect(api.callsTo('POST /api/auth/password/reset')[1]?.body).toEqual({
      email: 'sam@example.com',
      code: '123456',
      new_password: 'my-new-password',
    });
  });
});
