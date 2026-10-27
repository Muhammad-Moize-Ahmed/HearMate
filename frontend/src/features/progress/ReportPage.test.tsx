import { screen, within } from '@testing-library/react';

import { CHILD_ID } from '../../test/fixtures';
import { errorBody } from '../../test/mockApi';
import { mockProgressApi, reportOut, summaryOut } from '../../test/progressFixtures';
import { renderApp } from '../../test/renderApp';

const PAGE = `/parent/children/${CHILD_ID}/report`;
const REPORT = `GET /api/children/${CHILD_ID}/report`;

function rowOf(table: HTMLElement, name: string) {
  const row = within(table).getByRole('rowheader', { name }).closest('tr')!;
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
}

describe('Report page', () => {
  it('lays out the whole report, ready to print', async () => {
    mockProgressApi();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { user } = renderApp(PAGE);

    expect(await screen.findByText('HearMate progress report')).toBeInTheDocument();
    expect(screen.getByText(/30 days, times in Asia\/Karachi/)).toBeInTheDocument();

    const skills = screen.getByRole('table', { name: 'Skills' });
    expect(rowOf(skills, 'Listening')).toEqual(['3 (Easy)', '4', '73%', '▲ up 15 points']);
    expect(rowOf(skills, 'Speaking')).toEqual(['1 (Easy)', '0', '–', '–']);

    expect(rowOf(screen.getByRole('table', { name: 'Games' }), 'Similar Sounds')).toEqual([
      '3',
      '67%',
      '90%',
      '1.9 s',
    ]);
    expect(rowOf(screen.getByRole('table', { name: 'Listening in noise' }), 'Loud noise')).toEqual([
      'below 8 dB',
      '8',
      '38%',
    ]);
    expect(rowOf(screen.getByRole('table', { name: 'Hardest sound pairs' }), 'p/b')).toEqual([
      '4',
      '25%',
    ]);
    expect(screen.getByText('“th”')).toBeInTheDocument();
    expect(screen.getByText(/level 2 → 3/)).toHaveTextContent('(up)');
    expect(await screen.findByRole('img', { name: /^Average score by skill/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Print or save as PDF/ }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('reports on the period in the URL', async () => {
    const api = mockProgressApi();
    renderApp(`${PAGE}?range=custom&from=2026-10-01&to=2026-10-14`);

    await screen.findByText('HearMate progress report');
    expect(api.callsTo(REPORT)[0]!.query.toString()).toBe('days=14&end=2026-10-14');
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-14');
  });

  it('explains empty sections instead of showing empty tables', async () => {
    mockProgressApi({
      [REPORT]: {
        body: reportOut({
          summary: summaryOut({ in_period: { sessions: 0, points: 0, minutes: 0 } }),
          games: [],
          listening_in_noise: [],
          speech: { attempts: 0, average_score: null, sounds_to_practise: [] },
          hardest_contrasts: [],
          level_changes: [],
        }),
      },
    });
    renderApp(PAGE);

    expect(await screen.findByText('No games in this period.')).toBeInTheDocument();
    expect(screen.getByText('No rounds with background noise in this period.')).toBeInTheDocument();
    expect(screen.getByText('No speaking practice in this period.')).toBeInTheDocument();
    expect(screen.getByText('No Similar Sounds rounds in this period.')).toBeInTheDocument();
    expect(screen.getByText('No level changes in this period.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Games' })).not.toBeInTheDocument();
  });

  it('shows why a report cannot load', async () => {
    mockProgressApi({
      [REPORT]: { status: 403, body: errorBody('forbidden', 'Reports are for parents') },
    });
    renderApp(PAGE);

    expect(await screen.findByText(/We couldn't load the report/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled();
  });
});
