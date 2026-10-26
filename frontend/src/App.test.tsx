import { render, screen } from '@testing-library/react';

import App from './App.tsx';
import { mockApi } from './test/mockApi';

describe('App', () => {
  it('opens on the landing page and shows the API as online', async () => {
    mockApi({ 'GET /api/health': { body: { status: 'ok' } } });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Listening practice that feels like play' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('API online')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /I'm a kid, let's play!/ })).toHaveAttribute(
      'href',
      '/login?as=child',
    );
  });

  it('shows the API as unreachable when the health check fails', async () => {
    mockApi({ 'GET /api/health': { status: 503, body: {} } });

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
