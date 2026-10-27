import { fireEvent, screen, within } from '@testing-library/react';

import { addDays, todayISO } from '../../lib/dates';
import { CHILD_ID } from '../../test/fixtures';
import { errorBody } from '../../test/mockApi';
import { mockProgressApi, summaryOut, trend } from '../../test/progressFixtures';
import { renderApp } from '../../test/renderApp';

const PAGE = `/parent/children/${CHILD_ID}/progress`;
const TREND = `GET /api/children/${CHILD_ID}/progress/trend`;

describe('Progress page', () => {
  it('charts scores, levels, games and streaks, with the numbers also in tables', async () => {
    mockProgressApi();
    const { user } = renderApp(PAGE);

    expect(await screen.findByRole('heading', { name: "Ali's progress" })).toBeInTheDocument();
    const scores = await screen.findByRole('img', { name: /^Average score by skill/ });
    expect(scores).toHaveAccessibleName(
      'Average score by skill: Listening 60% to 90%; Memory 50%.',
    );
    expect(screen.getByRole('img', { name: /^Level by skill/ })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Games played each day: 5 in total.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Played on 3 of 30 days. Longest run in this period: 2 days.',
      }),
    ).toBeInTheDocument();

    // Every line is named in a legend, so colour is never the only cue.
    const scoresCard = scores.closest('section')!;
    const legend = within(scoresCard).getByRole('list', { name: 'Legend' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Listening', 'Memory']);

    // The same numbers as a table.
    await user.click(within(scoresCard).getByText('Show as a table'));
    const table = within(scoresCard).getByRole('table', { name: 'Scores over time' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(31);
    expect(
      within(rows.at(-1)!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['90%', '–']);

    // Split by game instead of skill.
    await user.click(within(scoresCard).getByRole('button', { name: 'By game' }));
    expect(
      within(scoresCard).getByRole('img', { name: /^Average score by game/ }),
    ).toHaveAccessibleName('Average score by game: Similar Sounds 60% to 90%; Word Sequence 50%.');

    expect(screen.getByRole('progressbar', { name: 'Listening week' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.getByText('First steps')).toBeInTheDocument();
    expect(screen.getByText('1 earned, 1 still to unlock.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Detailed report' })).toHaveAttribute(
      'href',
      `/parent/children/${CHILD_ID}/report`,
    );
  });

  it('asks for the chosen period: a preset by length, a custom range with its end date', async () => {
    const api = mockProgressApi();
    const { user, router } = renderApp(PAGE);
    await screen.findByRole('img', { name: /^Average score/ });

    const sent = () => api.callsTo(TREND).at(-1)!.query.toString();
    expect(sent()).toBe('days=30');
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(router.state.location.search).toBe('?range=week');
    await vi.waitFor(() => expect(sent()).toBe('days=7'));

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const today = todayISO();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: addDays(today, -2) } });
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least 7 days.');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: addDays(today, -13) } });
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await vi.waitFor(() => expect(sent()).toBe(`days=14&end=${today}`));
    expect(router.state.location.search).toBe(
      `?range=custom&from=${addDays(today, -13)}&to=${today}`,
    );
  });

  it('says so when there were no games in the period', async () => {
    mockProgressApi({
      [`GET /api/children/${CHILD_ID}/progress`]: {
        body: summaryOut({ in_period: { sessions: 0, points: 0, minutes: 0 }, active_goals: [] }),
      },
      [TREND]: { body: trend('2026-10-27', 30) },
    });
    renderApp(PAGE);

    expect(await screen.findAllByText(/No games in this period yet/)).toHaveLength(2);
    expect(screen.getByRole('img', { name: /^Level by skill/ })).toBeInTheDocument();
    expect(screen.getByText(/No active goals/)).toBeInTheDocument();
  });

  it('shows an error with a retry when progress cannot load', async () => {
    mockProgressApi({ [TREND]: { status: 503, body: errorBody('unavailable', 'Try later') } });
    renderApp(PAGE);

    expect(
      await screen.findByText(/We couldn't load Ali's progress/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is reached from the child’s page', async () => {
    mockProgressApi();
    const { user } = renderApp(`/parent/children/${CHILD_ID}`);

    await user.click(await screen.findByRole('link', { name: 'Progress' }));
    expect(await screen.findByRole('heading', { name: "Ali's progress" })).toBeInTheDocument();
  });
});
