import type { components } from '../api/schema';
import { mockApi, PARENT, tokenFor } from './mockApi';

type S = components['schemas'];

export const CHILD_ID = '44444444-4444-4444-4444-444444444444';

export function childOut(overrides: Partial<S['ChildOut']> = {}): S['ChildOut'] {
  return {
    id: CHILD_ID,
    display_name: 'Ali',
    date_of_birth: '2018-05-01',
    age_years: 8,
    gender: null,
    avatar: 'fox',
    hearing_difficulties: [],
    speech_challenges: [],
    interests: [],
    focus_areas: [],
    learning_environment: null,
    attention_span: null,
    preferred_learning_style: null,
    session_length_minutes: null,
    notes: null,
    timezone: 'Asia/Karachi',
    login: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

export function weekOut(overrides: Partial<S['FamilyMemberOut']> = {}): S['FamilyMemberOut'] {
  return {
    child_id: CHILD_ID,
    display_name: 'Ali',
    avatar: 'fox',
    this_week: { sessions: 4, points: 120, minutes: 35 },
    current_streak: 3,
    achievements_unlocked: 2,
    ...overrides,
  };
}

export function goalOut(overrides: Partial<S['GoalOut']> = {}): S['GoalOut'] {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    child_id: CHILD_ID,
    title: 'Listening week',
    category: 'listening',
    target_value: 5,
    current_value: 3,
    due_date: null,
    status: 'active',
    notes: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

type Routes = Parameters<typeof mockApi>[0];

/**
 * A signed-in parent with one child (Ali) and no goals; pass routes to add or override. The
 * child's GET returns `child`, so tests can change what later fetches see.
 */
export function mockParentApi(routes: Routes = {}, child = childOut()) {
  return mockApi({
    'POST /api/auth/refresh': { body: tokenFor(PARENT) },
    'GET /api/children': { body: [child] },
    [`GET /api/children/${child.id}`]: { body: child },
    'GET /api/family/progress': { body: [weekOut({ child_id: child.id })] },
    [`GET /api/children/${child.id}/goals`]: { body: [] },
    ...routes,
  });
}
