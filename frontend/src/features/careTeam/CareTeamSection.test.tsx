import { screen, within } from '@testing-library/react';

import { noteOut, parentLinkOut, planOut } from '../../test/careFixtures';
import { CHILD_ID, mockParentApi } from '../../test/fixtures';
import { errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const PAGE = `/parent/children/${CHILD_ID}`;
const TEAM = `/api/children/${CHILD_ID}/therapists`;

async function careTeam() {
  return (await screen.findByRole('heading', { name: 'Care team' })).closest('section')!;
}

describe('Care team (parent)', () => {
  it('invites a therapist by email and shows them as invited', async () => {
    let links: ReturnType<typeof parentLinkOut>[] = [];
    const api = mockParentApi({
      [`GET ${TEAM}`]: () => ({ body: links }),
      [`POST ${TEAM}`]: ({ body }) => {
        const { email } = body as { email: string };
        if (email === 'nobody@example.com') {
          return { status: 404, body: errorBody('therapist_not_found') };
        }
        links = [parentLinkOut({ status: 'pending', accepted_at: null })];
        return { status: 201, body: links[0] };
      },
    });
    const { user } = renderApp(PAGE);

    expect(await within(await careTeam()).findByText('No therapists yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Invite a therapist/ }));
    const email = screen.getByLabelText("Therapist's email");

    await user.type(email, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText("That doesn't look like an email address.")).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText(/No therapist account uses that email/)).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'sara@clinic.example');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/Invitation sent to sara@clinic.example/)).toBeInTheDocument();
    expect(await within(await careTeam()).findByText('Invited')).toBeInTheDocument();
    expect(within(await careTeam()).getByText('Sara Khan')).toBeInTheDocument();
    expect(api.callsTo(`POST ${TEAM}`).map((c) => c.body)).toEqual([
      { email: 'nobody@example.com' },
      { email: 'sara@clinic.example' },
    ]);
  });

  it("says when an invited therapist can't accept until approved", async () => {
    mockParentApi({
      [`GET ${TEAM}`]: {
        body: [
          parentLinkOut({
            status: 'pending',
            accepted_at: null,
            therapist: { ...parentLinkOut().therapist, approval_status: 'pending' },
          }),
        ],
      },
    });
    renderApp(PAGE);

    expect(await screen.findByText(/waiting for HearMate approval/)).toBeInTheDocument();
  });

  it("removes a therapist's access only after confirming", async () => {
    let links = [parentLinkOut()];
    const link = links[0]!;
    const api = mockParentApi({
      [`GET ${TEAM}`]: () => ({ body: links }),
      [`DELETE ${TEAM}/${link.id}`]: () => {
        links = [];
        return { status: 204 };
      },
    });
    const { user } = renderApp(PAGE);

    expect(await within(await careTeam()).findByText('Has access')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Remove Sara Khan's access" }));
    await user.keyboard('{Escape}');
    expect(api.callsTo(`DELETE ${TEAM}/${link.id}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: "Remove Sara Khan's access" }));
    const dialog = screen.getByRole('alertdialog', { name: "Remove Sara Khan's access?" });
    expect(dialog).toHaveTextContent('The notes they wrote stay visible to you.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove access' }));

    expect(await screen.findByText('Sara Khan no longer has access to Ali.')).toBeInTheDocument();
    expect(await within(await careTeam()).findByText('No therapists yet.')).toBeInTheDocument();
    expect(api.callsTo(`DELETE ${TEAM}/${link.id}`)).toHaveLength(1);
  });

  it('cancels a pending invitation', async () => {
    const link = parentLinkOut({ status: 'pending', accepted_at: null });
    const api = mockParentApi({
      [`GET ${TEAM}`]: { body: [link] },
      [`DELETE ${TEAM}/${link.id}`]: { status: 204 },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Sara Khan' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel invitation' }),
    );

    expect(api.callsTo(`DELETE ${TEAM}/${link.id}`)).toHaveLength(1);
  });
});

describe('Notes and learning plans (parent)', () => {
  it('reads them without any way to write', async () => {
    mockParentApi({
      [`GET /api/children/${CHILD_ID}/learning-plans`]: { body: [planOut()] },
      [`GET /api/children/${CHILD_ID}/notes`]: { body: [noteOut()] },
    });
    renderApp(PAGE);

    const plan = (await screen.findByText('Listening focus')).closest('article')!;
    expect(within(plan).getByText(/Started by Sara Khan/)).toBeInTheDocument();
    expect(within(plan).getByText(/3 times a week/)).toBeInTheDocument();
    expect(within(plan).queryByRole('button')).not.toBeInTheDocument();

    const note = (await screen.findByText('Good focus today.')).closest('article')!;
    expect(within(note).getByText('Sara Khan')).toBeInTheDocument();
    expect(within(note).queryByRole('button')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Add a note/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start a/ })).not.toBeInTheDocument();
  });

  it('explains empty notes and plans', async () => {
    mockParentApi();
    renderApp(PAGE);

    expect(await screen.findByText(/No learning plan yet/)).toBeInTheDocument();
    expect(
      await screen.findByText(/No notes yet\. Therapists on Ali's care team/),
    ).toBeInTheDocument();
  });
});
