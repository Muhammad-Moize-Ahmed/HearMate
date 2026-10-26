import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { Providers } from '../app/Providers';
import { createQueryClient } from '../app/queryClient';
import { routes } from '../app/routes';

/** Render the real app (routes, guards, providers) at `path`, with an in-memory history. */
export function renderApp(path: string, { state }: { state?: unknown } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [{ ...splitPath(path), state }] });
  const user = userEvent.setup();
  const view = render(
    <Providers queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router, user };
}

function splitPath(path: string) {
  const url = new URL(path, 'http://app.test');
  return { pathname: url.pathname, search: url.search };
}
