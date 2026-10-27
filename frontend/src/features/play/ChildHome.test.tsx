import { screen, within } from '@testing-library/react';

import { errorBody } from '../../test/mockApi';
import { mockChildApi } from '../../test/playFixtures';
import { renderApp } from '../../test/renderApp';

describe('Child home', () => {
  it("lists the games with the child's level for each, and their streak", async () => {
    mockChildApi();
    renderApp('/play');

    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(await screen.findByText('4 days in a row')).toBeInTheDocument();

    const detective = await screen.findByRole('link', { name: /Sound Detective/ });
    expect(detective).toHaveAttribute('href', '/play/games/sound-detective');
    expect(await within(detective).findByText('Level 2')).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: /Word Sequence/ })).getByText('Level 7'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: /Speech Practice/ })).getByText(
        /Uses the microphone/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Level/ })).toHaveLength(5);
  });

  it('marks speaking games as not ready when speech recognition is off', async () => {
    mockChildApi({
      'GET /api/speech/status': {
        body: { stt: { provider: null, available: false }, tts: { voice: null, available: true } },
      },
    });
    renderApp('/play');

    const speech = await screen.findByRole('link', { name: /Speech Practice/ });
    expect(await within(speech).findByText('Not ready yet')).toBeInTheDocument();
  });

  it('shows a friendly message when the games cannot load', async () => {
    mockChildApi({ 'GET /api/games': { status: 503, body: errorBody('unavailable') } });
    renderApp('/play');

    expect(
      await screen.findByText("We couldn't load the games.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('has a friendly empty state', async () => {
    mockChildApi({ 'GET /api/games': { body: [] } });
    renderApp('/play');

    expect(await screen.findByText(/No games yet/)).toBeInTheDocument();
  });

  it('never asks for therapist notes or learning plans', async () => {
    const api = mockChildApi();
    const { user } = renderApp('/play');

    await user.click(await screen.findByRole('link', { name: /Sound Detective/ }));
    await screen.findByRole('button', { name: /Start!/ });

    expect(api.calls.filter((c) => /notes|learning-plans/.test(c.path))).toEqual([]);
  });
});
