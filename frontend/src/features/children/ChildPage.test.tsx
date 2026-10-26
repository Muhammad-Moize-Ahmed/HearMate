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

  it('deletes the child only after their name is typed', async () => {
    const api = mockParentApi({ [`DELETE ${CHILD_URL}`]: { status: 204 } });
    const { user, router } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: "Delete Ali's profile" }));
    const dialog = screen.getByRole('alertdialog', { name: "Delete Ali's profile?" });
    const confirm = within(dialog).getByRole('button', { name: 'Delete forever' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Type Ali to confirm/), 'Ali');
    await user.click(confirm);

    await screen.findByText(/Here's how your children are getting on/);
    expect(router.state.location.pathname).toBe('/parent');
    expect(api.callsTo(`DELETE ${CHILD_URL}`)).toHaveLength(1);
  });

  it('closes the dialog with Escape without deleting', async () => {
    const api = mockParentApi();
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: "Delete Ali's profile" }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.callsTo(`DELETE ${CHILD_URL}`)).toHaveLength(0);
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
