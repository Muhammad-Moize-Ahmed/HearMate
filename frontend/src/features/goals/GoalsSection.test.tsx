import { screen, within } from '@testing-library/react';

import type { components } from '../../api/schema';
import { CHILD_ID, goalOut, mockParentApi } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

type Goal = components['schemas']['GoalOut'];

const PAGE = `/parent/children/${CHILD_ID}`;
const GOALS = `/api/children/${CHILD_ID}/goals`;

/** A goals endpoint backed by an in-memory list, so changes show up on the next fetch. */
function goalsBackend(initial: Goal[]) {
  let goals = [...initial];
  return {
    [`GET ${GOALS}`]: () => ({ body: goals }),
    [`POST ${GOALS}`]: ({ body }: { body: unknown }) => {
      const goal = goalOut({ id: `new-${goals.length}`, current_value: 0, ...(body as object) });
      goals = [...goals, goal];
      return { status: 201, body: goal };
    },
    ...Object.fromEntries(
      initial.flatMap((g) => [
        [
          `PATCH ${GOALS}/${g.id}`,
          ({ body }: { body: unknown }) => {
            goals = goals.map((x) => (x.id === g.id ? { ...x, ...(body as object) } : x));
            return { body: goals.find((x) => x.id === g.id) };
          },
        ],
        [
          `DELETE ${GOALS}/${g.id}`,
          () => {
            goals = goals.filter((x) => x.id !== g.id);
            return { status: 204 };
          },
        ],
      ]),
    ),
  };
}

describe('Goals', () => {
  it('shows progress, reached goals and archived goals', async () => {
    mockParentApi(
      goalsBackend([
        goalOut({ id: 'a', title: 'Listening week', current_value: 3, target_value: 5 }),
        goalOut({
          id: 'b',
          title: 'First game',
          status: 'achieved',
          current_value: 1,
          target_value: 1,
        }),
        goalOut({ id: 'c', title: 'Old goal', status: 'archived' }),
      ]),
    );
    renderApp(PAGE);

    const progress = await screen.findByRole('progressbar', { name: 'Progress on Listening week' });
    expect(progress).toHaveAttribute('aria-valuetext', '3 of 5');
    expect(screen.getByText(/Goal reached!/)).toBeInTheDocument();
    expect(screen.getByText('Archived goals (1)')).toBeInTheDocument();
  });

  it('adds a goal', async () => {
    const api = mockParentApi(goalsBackend([]));
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: /Add a goal/ }));
    await user.type(screen.getByLabelText('Goal'), 'Speaking practice');
    await user.click(screen.getByRole('radio', { name: /Speaking/ }));
    const count = screen.getByLabelText('How many games?');
    await user.clear(count);
    await user.type(count, '8');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));

    expect(await screen.findByRole('heading', { name: 'Speaking practice' })).toBeInTheDocument();
    expect(api.callsTo(`POST ${GOALS}`)[0]?.body).toEqual({
      title: 'Speaking practice',
      target_value: 8,
      category: 'speech',
      due_date: null,
      notes: null,
    });
  });

  it('checks a new goal before saving', async () => {
    const api = mockParentApi(goalsBackend([]));
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: /Add a goal/ }));
    await user.clear(screen.getByLabelText('How many games?'));
    await user.type(screen.getByLabelText('By (optional)'), '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));

    expect(await screen.findByText('Give the goal a name.')).toBeInTheDocument();
    expect(screen.getByText('Enter how many games.')).toBeInTheDocument();
    expect(screen.getByText("The date can't be in the past.")).toBeInTheDocument();
    expect(api.callsTo(`POST ${GOALS}`)).toHaveLength(0);
  });

  it('saves only what changed, and keeps a due date that has already passed', async () => {
    const api = mockParentApi(
      goalsBackend([goalOut({ id: 'a', title: 'Listening week', due_date: '2020-01-01' })]),
    );
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Edit Listening week' }));
    expect(screen.getByLabelText('By (optional)')).toHaveValue('2020-01-01');
    await user.clear(screen.getByLabelText('Goal'));
    await user.type(screen.getByLabelText('Goal'), 'Big listening week');
    await user.click(screen.getByRole('button', { name: 'Save goal' }));

    expect(await screen.findByRole('heading', { name: 'Big listening week' })).toBeInTheDocument();
    expect(api.callsTo(`PATCH ${GOALS}/a`)[0]?.body).toEqual({ title: 'Big listening week' });
  });

  it('archives, restores and deletes a goal', async () => {
    const api = mockParentApi(goalsBackend([goalOut({ id: 'a', title: 'Listening week' })]));
    const { user } = renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Archive Listening week' }));
    expect(await screen.findByText('Archived goals (1)')).toBeInTheDocument();
    await user.click(screen.getByText('Archived goals (1)'));
    await user.click(screen.getByRole('button', { name: 'Restore Listening week' }));
    await screen.findByRole('button', { name: 'Archive Listening week' });

    await user.click(screen.getByRole('button', { name: 'Delete Listening week' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this goal?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete goal' }));

    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
    expect(api.callsTo(`PATCH ${GOALS}/a`).map((c) => c.body)).toEqual([
      { status: 'archived' },
      { status: 'active' },
    ]);
    expect(api.callsTo(`DELETE ${GOALS}/a`)).toHaveLength(1);
  });
});
