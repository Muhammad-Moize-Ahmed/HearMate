import { screen } from '@testing-library/react';

import { CHILD } from '../../test/mockApi';
import { mockChildApi } from '../../test/playFixtures';
import { renderApp } from '../../test/renderApp';

/** Therapist notes and learning plans are for adults: a child's session never asks for them. */
describe("A child's session and the care team's pages", () => {
  it.each([
    `/parent/children/${CHILD.id}`,
    `/therapist/children/${CHILD.id}`,
    `/therapist/children/${CHILD.id}/report`,
    '/therapist',
    '/admin',
  ])('opening %s goes to the play area without asking for notes or plans', async (path) => {
    const api = mockChildApi();
    const { router } = renderApp(path);

    expect(await screen.findByRole('heading', { name: 'Hi Ali!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/play');
    expect(
      api.calls.filter((c) => /notes|learning-plans|therapist|report|admin/.test(c.path)),
    ).toEqual([]);
  });
});
