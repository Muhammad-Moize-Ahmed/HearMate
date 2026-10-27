import { screen, within } from '@testing-library/react';

import { CHILD, errorBody } from '../../test/mockApi';
import { mockChildApi } from '../../test/playFixtures';
import { ACHIEVEMENTS, played, trend } from '../../test/progressFixtures';
import { renderApp } from '../../test/renderApp';

const base = `/api/children/${CHILD.id}`;
const SISTER = {
  child_id: '77777777-7777-7777-7777-777777777777',
  display_name: 'Sara',
  avatar: 'cat',
  this_week: { sessions: 5, points: 150, minutes: 20 },
  current_streak: 0,
  achievements_unlocked: 2,
};

function mockMyProgress(routes: Parameters<typeof mockChildApi>[0] = {}) {
  return mockChildApi({
    [`GET ${base}/personal-bests`]: {
      body: [
        {
          game: 'sound-detective',
          title: 'Sound Detective',
          sessions: 4,
          best_accuracy: 95,
          best_points: 120,
          highest_level: 3,
          last_played_at: '2026-10-26T10:00:00Z',
        },
        {
          game: 'word-sequence',
          title: 'Word Sequence',
          sessions: 1,
          best_accuracy: 50,
          best_points: 40,
          highest_level: 1,
          last_played_at: '2026-10-20T10:00:00Z',
        },
      ],
    },
    [`GET ${base}/achievements`]: { body: ACHIEVEMENTS },
    [`GET ${base}/progress/trend`]: {
      body: trend('2026-10-27', 7, { '2026-10-26': [played('sound-detective', 95)] }),
    },
    ...routes,
  });
}

describe('My progress (child)', () => {
  it('shows stars, best games, this week and badges', async () => {
    const api = mockMyProgress();
    const { user } = renderApp('/play');

    await user.click(await screen.findByRole('link', { name: 'My progress' }));
    expect(await screen.findByRole('heading', { name: 'My progress' })).toBeInTheDocument();
    expect(await screen.findByText('4 stars')).toBeInTheDocument(); // 3 + 1

    const detective = screen.getByText('Sound Detective').closest('div')!;
    expect(within(detective).getByRole('img', { name: '3 out of 3 stars' })).toBeInTheDocument();
    expect(within(detective).getByText(/Best level 3 · played 4 times/)).toBeInTheDocument();
    expect(
      within(screen.getByText('Speech Practice').closest('div')!).getByText('Not played yet'),
    ).toBeInTheDocument();

    expect(api.callsTo(`GET ${base}/progress/trend`)[0]!.query.toString()).toBe('days=7');
    const week = screen.getByRole('heading', { name: 'My week' }).closest('section')!;
    expect(within(week).getAllByText(/: played/)).toHaveLength(1);
    expect(within(week).getAllByText(/: no games/)).toHaveLength(6);

    expect(screen.getByText('First steps').closest('li')).toHaveTextContent('(earned)');
    expect(screen.getByText('Week warrior').closest('li')).toHaveTextContent(
      'Keep playing to unlock!',
    );

    // Only one child in the family: nothing to compare with.
    expect(screen.queryByRole('heading', { name: 'My family this week' })).not.toBeInTheDocument();
  });

  it('shows brothers and sisters side by side, without ranking', async () => {
    mockMyProgress({
      'GET /api/family/progress': {
        body: [
          {
            child_id: CHILD.id,
            display_name: 'Ali',
            avatar: 'fox',
            this_week: { sessions: 3, points: 90, minutes: 12 },
            current_streak: 4,
            achievements_unlocked: 1,
          },
          SISTER,
        ],
      },
    });
    renderApp('/play/progress');

    const family = (await screen.findByRole('heading', { name: 'My family this week' })).closest(
      'section',
    )!;
    const members = within(family).getAllByRole('listitem');
    expect(members.map((m) => m.textContent)).toEqual([
      '🦊Ali (you)3 games · 🔥 4 days in a row',
      '🐱Sara5 games',
    ]);
  });

  it('never asks for therapist notes, learning plans or the detailed report', async () => {
    const api = mockMyProgress();
    renderApp('/play/progress');

    await screen.findByText('First steps');
    expect(api.calls.filter((c) => /notes|learning-plans|report/.test(c.path))).toEqual([]);
  });

  it('has a friendly error with a retry', async () => {
    mockMyProgress({ [`GET ${base}/personal-bests`]: { status: 403, body: errorBody('nope') } });
    renderApp('/play/progress');

    expect(await screen.findByText("We couldn't load your stars.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
