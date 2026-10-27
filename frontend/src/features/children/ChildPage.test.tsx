import { screen, within } from '@testing-library/react';

import { CHILD_ID, childOut, mockParentApi } from '../../test/fixtures';
import { errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const PAGE = `/parent/children/${CHILD_ID}`;
const CHILD_URL = `/api/children/${CHILD_ID}`;

describe('Child page', () => {
  it("shows the child's week and profile in plain words", async () => {
    mockParentApi(
      {},
      childOut({
        hearing_difficulties: ['noisy_environments'],
        interests: ['space', 'retired_option'],
        session_length_minutes: 15,
        notes: 'Shy at first.',
      }),
    );
    renderApp(PAGE);

    expect(await screen.findByRole('heading', { name: 'Ali', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Games this week')).toBeInTheDocument();
    expect(screen.getByText('Following talk in noisy places')).toBeInTheDocument();
    expect(screen.getByText('🪐 Space')).toBeInTheDocument();
    expect(screen.getByText('retired option')).toBeInTheDocument(); // unknown keys still show
    expect(screen.getByText('15 minutes')).toBeInTheDocument();
    expect(screen.getByText('Shy at first.')).toBeInTheDocument();
  });

  it("explains when a child can't be found", async () => {
    mockParentApi({ [`GET ${CHILD_URL}`]: { status: 404, body: errorBody('not_found') } });
    renderApp(PAGE);

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't find that child");
  });

  it('edits the profile and goes back to the child page', async () => {
    const api = mockParentApi({
      [`PATCH ${CHILD_URL}`]: ({ body }) => ({ body: childOut(body as object) }),
    });
    const { user, router } = renderApp(PAGE);

    await user.click(await screen.findByRole('link', { name: 'Edit profile' }));
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Ali');
    await user.clear(name);
    await user.type(name, 'Ali Khan');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'Ali Khan', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PAGE);
    expect(api.callsTo(`PATCH ${CHILD_URL}`)[0]?.body).toMatchObject({
      display_name: 'Ali Khan',
      date_of_birth: '2018-05-01',
      avatar: 'fox',
      timezone: 'Asia/Karachi',
    });
  });

  it('deletes the child after "I understand" and the password, then says so', async () => {
    const api = mockParentApi({
      [`POST ${CHILD_URL}/delete`]: ({ body }) =>
        (body as { password: string }).password === 'a-long-password'
          ? { status: 204 }
          : { status: 403, body: errorBody('wrong_password') },
    });
    const { user, router, queryClient } = renderApp(PAGE);

    await user.click(await screen.findByRole('link', { name: "Delete Ali's profile…" }));
    expect(
      await screen.findByRole('heading', { name: "Delete Ali's profile?" }),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', { name: "Delete Ali's profile forever" });
    expect(button).toBeDisabled();
    await user.click(screen.getByLabelText('I understand that this is permanent.'));
    await user.type(screen.getByLabelText('Your password'), 'wrong-password');
    await user.click(button);

    expect(
      await screen.findByText("That password isn't right. Nothing has been deleted."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${PAGE}/delete`);

    await user.clear(screen.getByLabelText('Your password'));
    await user.type(screen.getByLabelText('Your password'), 'a-long-password');
    await user.click(button);

    expect(
      await screen.findByText("The profile was deleted. We've emailed you to confirm."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/parent');
    expect(api.callsTo(`POST ${CHILD_URL}/delete`).map((c) => c.body)).toEqual([
      { password: 'wrong-password' },
      { password: 'a-long-password' },
    ]);
    // Nothing about the child is kept in memory (and they aren't fetched again), and no name is
    // put in the history state.
    const childData = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'children' && q.queryKey[1] === CHILD_ID)
      .filter((q) => q.state.data !== undefined);
    expect(childData).toEqual([]);
    expect(api.callsTo(`GET ${CHILD_URL}`)).toHaveLength(1);
    expect(JSON.stringify(router.state.location.state)).not.toContain('Ali');
  });

  it('goes back without deleting', async () => {
    const api = mockParentApi();
    const { user, router } = renderApp(`${PAGE}/delete`);

    await user.click(await screen.findByRole('link', { name: 'Cancel' }));

    await screen.findByRole('heading', { name: 'Ali' });
    expect(router.state.location.pathname).toBe(PAGE);
    expect(api.callsTo(`POST ${CHILD_URL}/delete`)).toHaveLength(0);
  });
});

describe("Child's sign-in", () => {
  it('sets a username and PIN, checking the PIN first', async () => {
    let attempt = 0;
    const api = mockParentApi({
      [`PUT ${CHILD_URL}/login`]: ({ body }) => {
        attempt += 1;
        if (attempt === 1) return { status: 409, body: errorBody('username_taken') };
        const { username } = body as { username: string };
        return { body: childOut({ login: { username } }) };
      },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Set up sign-in' }));
    const username = screen.getByLabelText('Username');
    expect(username).toHaveValue('ali'); // suggested from the name

    await user.type(screen.getByLabelText('PIN'), '1234');
    await user.type(screen.getByLabelText('Type the PIN again'), '1234');
    await user.click(screen.getByRole('button', { name: 'Save sign-in' }));
    expect(await screen.findByText(/Pick a PIN that is harder to guess/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('PIN'));
    await user.type(screen.getByLabelText('PIN'), '4826');
    await user.clear(screen.getByLabelText('Type the PIN again'));
    await user.type(screen.getByLabelText('Type the PIN again'), '4862');
    await user.click(screen.getByRole('button', { name: 'Save sign-in' }));
    expect(await screen.findByText("The PINs don't match.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Type the PIN again'));
    await user.type(screen.getByLabelText('Type the PIN again'), '4826');
    await user.click(screen.getByRole('button', { name: 'Save sign-in' }));
    expect(await screen.findByText(/That username is taken/)).toBeInTheDocument();

    await user.clear(username);
    await user.type(username, ' Ali.K ');
    await user.click(screen.getByRole('button', { name: 'Save sign-in' }));

    expect(await screen.findByText(/Saved!/)).toHaveTextContent('ali.k');
    expect(screen.getByRole('button', { name: 'Change username or PIN' })).toBeInTheDocument();
    expect(api.callsTo(`PUT ${CHILD_URL}/login`).map((c) => c.body)).toEqual([
      { username: 'ali', pin: '4826' },
      { username: 'ali.k', pin: '4826' },
    ]);
  });

  it('turns sign-in off after confirming', async () => {
    const api = mockParentApi(
      { [`DELETE ${CHILD_URL}/login`]: { body: childOut({ login: null }) } },
      childOut({ login: { username: 'ali' } }),
    );
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Turn off sign-in' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off sign-in' }));

    expect(await screen.findByText('Ali can no longer sign in on their own.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up sign-in' })).toBeInTheDocument();
    expect(api.callsTo(`DELETE ${CHILD_URL}/login`)).toHaveLength(1);
  });
});
