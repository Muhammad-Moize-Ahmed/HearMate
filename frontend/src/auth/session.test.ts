import { errorBody, mockApi, PARENT, tokenFor } from '../test/mockApi';
import { authFetch, getEndReason, getSession, refreshSession, startSession } from './session';

const API = window.location.origin;

describe('refreshSession', () => {
  it('sends overlapping refreshes as one request, so the refresh token is never reused', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': { body: tokenFor(PARENT) } });

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(api.callsTo('POST /api/auth/refresh')).toHaveLength(1);
    expect(results.every((s) => s?.accessToken === 'access-1')).toBe(true);
    expect(getSession()?.principal.kind).toBe('parent');
  });

  it('ends an existing session as "expired" when the refresh is refused', async () => {
    mockApi({ 'POST /api/auth/refresh': { status: 401, body: errorBody('invalid_token') } });
    startSession(tokenFor(PARENT) as never);

    expect(await refreshSession()).toBeNull();
    expect(getSession()).toBeNull();
    expect(getEndReason()).toBe('expired');
  });

  it('keeps the session when the server is down, and reports the error', async () => {
    mockApi({ 'POST /api/auth/refresh': { status: 503, body: errorBody('unavailable') } });
    startSession(tokenFor(PARENT) as never);

    await expect(refreshSession()).rejects.toMatchObject({ status: 503 });
    expect(getSession()).not.toBeNull();
  });
});

describe('authFetch', () => {
  it('sends the access token', async () => {
    const api = mockApi({ 'GET /api/children': { body: [] } });
    startSession(tokenFor(PARENT, 'token-a') as never);

    await authFetch(new Request(`${API}/api/children`));

    expect(api.calls[0]?.headers.get('Authorization')).toBe('Bearer token-a');
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    let first = true;
    const api = mockApi({
      'GET /api/children': () => {
        const reply = first ? { status: 401, body: errorBody('invalid_token') } : { body: [] };
        first = false;
        return reply;
      },
      'POST /api/auth/refresh': { body: tokenFor(PARENT, 'token-b') },
    });
    startSession(tokenFor(PARENT, 'token-a') as never);

    const response = await authFetch(new Request(`${API}/api/children`));

    expect(response.status).toBe(200);
    const sent = api.callsTo('GET /api/children').map((c) => c.headers.get('Authorization'));
    expect(sent).toEqual(['Bearer token-a', 'Bearer token-b']);
  });

  it('refreshes first when the token is about to expire', async () => {
    const api = mockApi({
      'GET /api/children': { body: [] },
      'POST /api/auth/refresh': { body: tokenFor(PARENT, 'fresh') },
    });
    startSession({ ...tokenFor(PARENT, 'stale'), expires_in: 5 } as never);

    await authFetch(new Request(`${API}/api/children`));

    expect(api.calls.map((c) => c.path)).toEqual(['/api/auth/refresh', '/api/children']);
    expect(api.calls[1]?.headers.get('Authorization')).toBe('Bearer fresh');
  });

  it('does not try to refresh when nobody is signed in', async () => {
    const api = mockApi({
      'GET /api/children': { status: 401, body: errorBody('unauthenticated') },
    });

    const response = await authFetch(new Request(`${API}/api/children`));

    expect(response.status).toBe(401);
    expect(api.callsTo('POST /api/auth/refresh')).toHaveLength(0);
  });
});
