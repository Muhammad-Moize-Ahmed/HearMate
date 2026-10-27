import { screen, within } from '@testing-library/react';

import {
  linkOut,
  mockTherapistApi,
  noteOut,
  OTHER_AUTHOR,
  OTHER_CHILD_ID,
  planOut,
} from '../../test/careFixtures';
import { CHILD_ID } from '../../test/fixtures';
import { errorBody, mockApi, THERAPIST, tokenFor } from '../../test/mockApi';
import { GAMES } from '../../test/playFixtures';
import { ACHIEVEMENTS, reportOut, summaryOut, trend } from '../../test/progressFixtures';
import { renderApp } from '../../test/renderApp';

const PAGE = `/therapist/children/${CHILD_ID}`;
const base = `/api/children/${CHILD_ID}`;

/** Any request about a given child, by id. */
const callsAbout = (calls: { path: string }[], childId: string) =>
  calls.filter((c) => c.path.includes(childId));

describe('Therapist access to children', () => {
  it('opens a linked child with their plan, notes and profile', async () => {
    mockTherapistApi({
      [`GET ${base}/learning-plans`]: { body: [planOut()] },
      [`GET ${base}/notes`]: { body: [noteOut()] },
    });
    renderApp(PAGE);

    expect(await screen.findByRole('heading', { name: 'Ali', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/parent Sam Parent/)).toBeInTheDocument();
    expect(await screen.findByText('Listening focus')).toBeInTheDocument();
    expect(await screen.findByText('Good focus today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Progress/ })).toHaveAttribute(
      'href',
      `${PAGE}/progress`,
    );
  });

  it('cannot open a child it is not linked to, and asks nothing about them', async () => {
    const api = mockTherapistApi();
    renderApp(`/therapist/children/${OTHER_CHILD_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to this child",
    );
    expect(callsAbout(api.calls, OTHER_CHILD_ID)).toEqual([]);
  });

  it("cannot open a child's progress or report without a link either", async () => {
    const api = mockTherapistApi();
    const { router } = renderApp(`/therapist/children/${OTHER_CHILD_ID}/report`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to this child",
    );
    await router.navigate(`/therapist/children/${OTHER_CHILD_ID}/progress`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to this child",
    );
    expect(callsAbout(api.calls, OTHER_CHILD_ID)).toEqual([]);
  });

  it('treats an invitation that is not accepted yet as no access', async () => {
    const api = mockTherapistApi({}, [linkOut({ status: 'pending', accepted_at: null })]);
    renderApp(PAGE);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to this child",
    );
    expect(callsAbout(api.calls, CHILD_ID)).toEqual([]);
  });

  it('gives a therapist waiting for approval no access to any child', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': { body: tokenFor(THERAPIST) } });
    renderApp(PAGE);

    expect(await screen.findByRole('alert')).toHaveTextContent(/waiting for admin approval/);
    expect(api.calls.filter((c) => c.path !== '/api/auth/refresh')).toEqual([]);
  });

  it("shows the linked child's progress and report in the therapist's area", async () => {
    mockTherapistApi({
      'GET /api/games': { body: GAMES },
      [`GET ${base}/progress`]: { body: summaryOut({ active_goals: [] }) },
      [`GET ${base}/progress/trend`]: { body: trend('2026-10-27', 30) },
      [`GET ${base}/achievements`]: { body: ACHIEVEMENTS },
      [`GET ${base}/report`]: { body: reportOut() },
    });
    const { user, router } = renderApp(`${PAGE}/progress`);

    expect(await screen.findByRole('heading', { name: "Ali's progress" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Ali's profile" })).toHaveAttribute('href', PAGE);
    // Goals are the parent's; a therapist isn't sent off to set one.
    expect(await screen.findByText(/No active goals/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Set one/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Detailed report' }));
    expect(await screen.findByText('HearMate progress report')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${PAGE}/report`);
    expect(screen.getByRole('link', { name: "Ali's progress" })).toHaveAttribute(
      'href',
      `${PAGE}/progress`,
    );
  });

  it('leaves the care team after confirming', async () => {
    const api = mockTherapistApi({
      [`DELETE /api/therapist/links/${linkOut().id}`]: { status: 204 },
    });
    const { user, router } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: "Leave Ali's care team" }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave care team' }),
    );

    await screen.findByRole('heading', { name: 'Patients' });
    expect(router.state.location.pathname).toBe('/therapist');
    expect(api.callsTo(`DELETE /api/therapist/links/${linkOut().id}`)).toHaveLength(1);
  });
});

describe('Therapist notes', () => {
  it('writes a note', async () => {
    let notes: ReturnType<typeof noteOut>[] = [];
    const api = mockTherapistApi({
      [`GET ${base}/notes`]: () => ({ body: notes }),
      [`POST ${base}/notes`]: ({ body }) => {
        notes = [noteOut({ body: (body as { body: string }).body })];
        return { status: 201, body: notes[0] };
      },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: /Add a note/ }));
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Write something first.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Note'), '  Worked on p/b pairs.  ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Worked on p/b pairs.')).toBeInTheDocument();
    expect(api.callsTo(`POST ${base}/notes`).map((c) => c.body)).toEqual([
      { body: 'Worked on p/b pairs.' },
    ]);
  });

  it("edits and deletes only the therapist's own notes", async () => {
    const mine = noteOut();
    const theirs = noteOut({
      id: 'cccccccc-0000-0000-0000-000000000002',
      author: OTHER_AUTHOR,
      body: 'Struggles in noise.',
    });
    const api = mockTherapistApi({
      [`GET ${base}/notes`]: { body: [mine, theirs] },
      [`PATCH ${base}/notes/${mine.id}`]: ({ body }) => ({
        body: { ...mine, ...(body as object) },
      }),
      [`DELETE ${base}/notes/${mine.id}`]: { status: 204 },
    });
    const { user } = renderApp(PAGE);

    const theirCard = (await screen.findByText('Struggles in noise.')).closest('article')!;
    expect(within(theirCard).getByText('Omar Raza')).toBeInTheDocument();
    expect(within(theirCard).queryByRole('button')).not.toBeInTheDocument();

    const myCard = screen.getByText('Good focus today.').closest('article')!;
    await user.click(within(myCard).getByRole('button', { name: /^Edit note/ }));
    const field = screen.getByLabelText('Note');
    await user.clear(field);
    await user.type(field, 'Great focus today.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Good focus today.'); // the list refetches (unchanged in this mock)
    expect(api.callsTo(`PATCH ${base}/notes/${mine.id}`).map((c) => c.body)).toEqual([
      { body: 'Great focus today.' },
    ]);

    await user.click(screen.getByRole('button', { name: /^Delete note/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this note?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    expect(api.callsTo(`DELETE ${base}/notes/${mine.id}`)).toHaveLength(1);
  });

  it('loads older notes a page at a time', async () => {
    const page = Array.from({ length: 50 }, (_, i) =>
      noteOut({
        id: `cccccccc-0000-0000-0000-${String(i).padStart(12, '0')}`,
        body: `Note ${i}`,
        created_at: `2026-10-${String(27 - Math.floor(i / 10)).padStart(2, '0')}T${String(23 - (i % 10)).padStart(2, '0')}:00:00Z`,
      }),
    );
    const older = noteOut({ id: 'cccccccc-1111-0000-0000-000000000000', body: 'The first note' });
    const api = mockTherapistApi({
      [`GET ${base}/notes`]: ({ query }) => ({ body: query.get('before') ? [older] : page }),
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Show older notes' }));

    expect(await screen.findByText('The first note')).toBeInTheDocument();
    const [, second] = api.callsTo(`GET ${base}/notes`);
    expect(second!.query.get('before')).toBe(page[49]!.created_at);
    expect(screen.queryByRole('button', { name: 'Show older notes' })).not.toBeInTheDocument();
  });
});

describe('Learning plans', () => {
  it('starts a plan with chosen games', async () => {
    let plans: ReturnType<typeof planOut>[] = [];
    const api = mockTherapistApi({
      'GET /api/games': { body: GAMES },
      [`GET ${base}/learning-plans`]: () => ({ body: plans }),
      [`POST ${base}/learning-plans`]: ({ body }) => {
        plans = [planOut({ title: (body as { title: string }).title })];
        return { status: 201, body: plans[0] };
      },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: /Start a plan/ }));
    await user.type(await screen.findByLabelText('Plan name'), 'Noise week');
    await user.click(screen.getByRole('checkbox', { name: 'Listening in Noise' }));
    const times = screen.getByLabelText('Times a week');
    await user.clear(times);
    await user.type(times, '30');
    await user.click(screen.getByRole('button', { name: 'Start plan' }));
    expect(await screen.findByText('Use a whole number from 1 to 21.')).toBeInTheDocument();

    await user.clear(times);
    await user.type(times, '4');
    await user.selectOptions(screen.getByLabelText('Suggested difficulty'), 'medium');
    await user.click(screen.getByRole('button', { name: 'Start plan' }));

    expect(await screen.findByText('Noise week')).toBeInTheDocument();
    expect(api.callsTo(`POST ${base}/learning-plans`).map((c) => c.body)).toEqual([
      {
        title: 'Noise week',
        notes: null,
        items: [
          { game: 'listening-in-noise', sessions_per_week: 4, difficulty: 'medium', notes: null },
        ],
      },
    ]);
  });

  it('edits the active plan, sending only what changed', async () => {
    const plan = planOut();
    const api = mockTherapistApi({
      'GET /api/games': { body: GAMES },
      [`GET ${base}/learning-plans`]: { body: [plan] },
      [`PATCH ${base}/learning-plans/${plan.id}`]: { body: plan },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Edit Listening focus' }));
    const times = await screen.findByLabelText('Times a week');
    expect(times).toHaveValue(3);
    await user.clear(times);
    await user.type(times, '5');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    await screen.findByRole('button', { name: 'Edit Listening focus' });
    expect(api.callsTo(`PATCH ${base}/learning-plans/${plan.id}`).map((c) => c.body)).toEqual([
      {
        items: [{ game: 'similar-sounds', sessions_per_week: 5, difficulty: 'easy', notes: null }],
      },
    ]);
  });

  it('archives the active plan after confirming, and keeps earlier plans readable', async () => {
    const plan = planOut();
    const old = planOut({
      id: 'dddddddd-0000-0000-0000-000000000002',
      title: 'Spring plan',
      is_active: false,
    });
    const api = mockTherapistApi({
      [`GET ${base}/learning-plans`]: { body: [plan, old] },
      [`POST ${base}/learning-plans/${plan.id}/archive`]: { body: { ...plan, is_active: false } },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByText('Earlier plans (1)'));
    const oldCard = screen.getByText('Spring plan').closest('article')!;
    expect(within(oldCard).queryByRole('button')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Listening focus' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive plan' }),
    );
    expect(api.callsTo(`POST ${base}/learning-plans/${plan.id}/archive`)).toHaveLength(1);
  });

  it('explains when another therapist changed the plan at the same time', async () => {
    const plan = planOut();
    mockTherapistApi({
      'GET /api/games': { body: GAMES },
      [`GET ${base}/learning-plans`]: { body: [plan] },
      [`POST ${base}/learning-plans`]: { status: 409, body: errorBody('plan_changed') },
    });
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: /Start a new plan/ }));
    await user.type(await screen.findByLabelText('Plan name'), 'New plan');
    expect(screen.getByText(/The current plan is archived/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start plan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another therapist changed the plan at the same moment',
    );
  });
});
