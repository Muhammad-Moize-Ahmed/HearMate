import { screen, within } from '@testing-library/react';

import { CHILD_ID, childOut, mockParentApi } from '../../test/fixtures';
import { errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

describe('Parent dashboard', () => {
  it('invites a new parent to add their first child', async () => {
    mockParentApi({ 'GET /api/children': { body: [] }, 'GET /api/family/progress': { body: [] } });
    renderApp('/parent');

    expect(
      await screen.findByRole('heading', { name: "Let's add your first child" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a child' })).toHaveAttribute(
      'href',
      '/parent/children/new',
    );
  });

  it("shows each child's week and whether they can sign in", async () => {
    mockParentApi({
      'GET /api/children': {
        body: [
          childOut({ login: { username: 'ali' } }),
          childOut({ id: 'other', display_name: 'Sara', avatar: 'owl', age_years: 1 }),
        ],
      },
    });
    const { user, router } = renderApp('/parent');

    const ali = await screen.findByRole('link', { name: /Ali/ });
    expect(within(ali).getByText('8 years old')).toBeInTheDocument();
    expect(within(ali).getByText('Signs in as ali')).toBeInTheDocument();
    expect(within(ali).getByText('games this week').nextSibling).toHaveTextContent('4');
    expect(within(ali).getByText('day streak').nextSibling).toHaveTextContent('3');

    const sara = screen.getByRole('link', { name: /Sara/ });
    expect(within(sara).getByText('1 year old')).toBeInTheDocument();
    expect(within(sara).getByText('Sign-in not set up yet')).toBeInTheDocument();
    expect(within(sara).getByText('games this week').nextSibling).toHaveTextContent('–');

    await user.click(ali);
    expect(await screen.findByRole('heading', { name: 'Ali', level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/parent/children/${CHILD_ID}`);
  });

  it('offers to try again when the list fails to load', async () => {
    mockParentApi({ 'GET /api/children': { status: 503, body: errorBody('unavailable') } });
    renderApp('/parent');

    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side');
  });
});

describe('Add a child', () => {
  it('checks the form before saving', async () => {
    const api = mockParentApi();
    const { user } = renderApp('/parent/children/new');

    await user.click(await screen.findByRole('button', { name: 'Add child' }));

    expect(await screen.findByText('Please enter a name.')).toBeInTheDocument();
    expect(screen.getByText('Please enter their date of birth.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Date of birth'), '2099-01-01');
    await user.click(screen.getByRole('button', { name: 'Add child' }));
    expect(await screen.findByText("That date hasn't happened yet.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Date of birth'));
    await user.type(screen.getByLabelText('Date of birth'), '2001-01-01');
    await user.click(screen.getByRole('button', { name: 'Add child' }));
    expect(await screen.findByText('HearMate is for children under 18.')).toBeInTheDocument();

    expect(api.callsTo('POST /api/children')).toHaveLength(0);
  });

  it('creates the profile and opens it, prompting to set up sign-in', async () => {
    const created = childOut({ display_name: 'Zara', avatar: 'owl', interests: ['dinosaurs'] });
    const api = mockParentApi({ 'POST /api/children': { status: 201, body: created } }, created);
    const { user, router } = renderApp('/parent/children/new');

    await user.type(await screen.findByLabelText('Name'), ' Zara ');
    await user.type(screen.getByLabelText('Date of birth'), '2019-03-14');
    await user.click(screen.getByRole('radio', { name: 'Owl' }));
    await user.click(screen.getByRole('checkbox', { name: /Dinosaurs/ }));
    await user.click(screen.getByRole('checkbox', { name: /Telling similar sounds apart/ }));
    await user.click(screen.getByRole('radio', { name: '10 min' }));
    await user.selectOptions(screen.getByLabelText('Attention span'), 'short');
    await user.click(screen.getByRole('button', { name: 'Add Zara' }));

    expect(await screen.findByText(/Zara's profile is ready!/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/parent/children/${CHILD_ID}`);
    expect(api.callsTo('POST /api/children')[0]?.body).toEqual({
      display_name: 'Zara',
      date_of_birth: '2019-03-14',
      avatar: 'owl',
      gender: null,
      hearing_difficulties: ['sound_discrimination'],
      speech_challenges: [],
      focus_areas: [],
      interests: ['dinosaurs'],
      learning_environment: null,
      attention_span: 'short',
      preferred_learning_style: null,
      session_length_minutes: 10,
      notes: null,
      // A new child gets this device's time zone.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });
});
