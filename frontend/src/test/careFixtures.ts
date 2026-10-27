import type { components } from '../api/schema';
import { CHILD_ID, childOut } from './fixtures';
import { mockApi, PARENT, THERAPIST, tokenFor } from './mockApi';

type S = components['schemas'];
type Routes = Parameters<typeof mockApi>[0];

export const APPROVED_THERAPIST = { ...THERAPIST, therapist_status: 'approved' };

export const ADMIN = {
  ...PARENT,
  kind: 'admin',
  id: '99999999-9999-9999-9999-999999999999',
  email: 'admin@example.com',
  first_name: 'Ada',
  last_name: 'Admin',
};

/** A child of another family that this therapist is *not* linked to. */
export const OTHER_CHILD_ID = '88888888-8888-8888-8888-888888888888';

const AUTHOR = { id: THERAPIST.id, first_name: 'Sara', last_name: 'Khan' };
export const OTHER_AUTHOR = {
  id: '66666666-6666-6666-6666-666666666666',
  first_name: 'Omar',
  last_name: 'Raza',
};

/** An invitation or link, as the therapist sees it. */
export function linkOut(overrides: Partial<S['TherapistLinkOut']> = {}): S['TherapistLinkOut'] {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    status: 'active',
    child: { id: CHILD_ID, display_name: 'Ali', age_years: 8, avatar: 'fox' },
    parent: { first_name: 'Sam', last_name: 'Parent' },
    created_at: '2026-10-01T10:00:00Z',
    accepted_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

/** A therapist on a child's care team, as the parent sees it. */
export function parentLinkOut(overrides: Partial<S['ParentLinkOut']> = {}): S['ParentLinkOut'] {
  return {
    id: 'bbbbbbbb-0000-0000-0000-000000000001',
    status: 'active',
    therapist: {
      id: THERAPIST.id,
      first_name: 'Sara',
      last_name: 'Khan',
      email: 'sara@clinic.example',
      organization: 'City Clinic',
      specialization: 'Audiology',
      approval_status: 'approved',
    },
    created_at: '2026-10-01T10:00:00Z',
    accepted_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

export function noteOut(overrides: Partial<S['NoteOut']> = {}): S['NoteOut'] {
  return {
    id: 'cccccccc-0000-0000-0000-000000000001',
    child_id: CHILD_ID,
    author: AUTHOR,
    body: 'Good focus today.',
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
    ...overrides,
  };
}

export function planOut(overrides: Partial<S['LearningPlanOut']> = {}): S['LearningPlanOut'] {
  return {
    id: 'dddddddd-0000-0000-0000-000000000001',
    child_id: CHILD_ID,
    title: 'Listening focus',
    notes: 'Short sessions after school.',
    is_active: true,
    created_by: AUTHOR,
    items: [
      {
        id: 'eeeeeeee-0000-0000-0000-000000000001',
        game: { slug: 'similar-sounds', title: 'Similar Sounds', category: 'listening' },
        sessions_per_week: 3,
        difficulty: 'easy',
        notes: null,
      },
    ],
    created_at: '2026-10-10T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    ...overrides,
  };
}

export function therapistOut(overrides: Partial<S['TherapistOut']> = {}): S['TherapistOut'] {
  return {
    id: THERAPIST.id,
    email: 'sara@clinic.example',
    first_name: 'Sara',
    last_name: 'Khan',
    email_verified: true,
    license_number: 'PK-123',
    organization: 'City Clinic',
    specialization: 'Audiology',
    approval_status: 'pending',
    rejection_reason: null,
    reviewed_at: null,
    created_at: '2026-10-20T10:00:00Z',
    ...overrides,
  };
}

/**
 * A signed-in, approved therapist actively linked to Ali, with no notes or plans yet; pass routes
 * to add or override, and `links` to change the caseload.
 */
export function mockTherapistApi(routes: Routes = {}, links = [linkOut()]) {
  const base = `/api/children/${CHILD_ID}`;
  return mockApi({
    'POST /api/auth/refresh': { body: tokenFor(APPROVED_THERAPIST) },
    'GET /api/therapist/links': { body: links },
    [`GET ${base}`]: { body: childOut({ login: null }) },
    [`GET ${base}/notes`]: { body: [] },
    [`GET ${base}/learning-plans`]: { body: [] },
    ...routes,
  });
}
