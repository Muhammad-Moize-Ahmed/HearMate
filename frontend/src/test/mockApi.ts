/**
 * A fake backend for tests: stubs `fetch` and answers by "METHOD /path". Unhandled requests fail
 * the test loudly. Every call is recorded with its query, parsed JSON body and headers.
 */
type Reply = { status?: number; body?: unknown };
type Handler = (call: RecordedCall) => Reply | Promise<Reply>;

export type RecordedCall = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
};

export function errorBody(code: string, message = code, details?: unknown) {
  return { error: { code, message, details, request_id: 'test' } };
}

export function tokenFor(principal: Record<string, unknown>, accessToken = 'access-1') {
  return { access_token: accessToken, token_type: 'bearer', expires_in: 900, principal };
}

export const PARENT = {
  kind: 'parent',
  id: '11111111-1111-1111-1111-111111111111',
  email: 'sam@example.com',
  first_name: 'Sam',
  last_name: 'Parent',
  therapist_status: null,
};

export const THERAPIST = {
  ...PARENT,
  kind: 'therapist',
  id: '22222222-2222-2222-2222-222222222222',
  first_name: 'Sara',
  therapist_status: 'pending',
};

export const CHILD = {
  kind: 'child',
  id: '33333333-3333-3333-3333-333333333333',
  display_name: 'Ali',
  avatar: 'fox',
};

export function mockApi(routes: Record<string, Handler | Reply>) {
  const calls: RecordedCall[] = [];
  const handlers = new Map(Object.entries(routes));
  // With no sign-in cookie, the page-load refresh is a 401, as on a first visit.
  if (!handlers.has('POST /api/auth/refresh')) {
    handlers.set('POST /api/auth/refresh', { status: 401, body: errorBody('invalid_token') });
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), window.location.origin),
      init,
    );
    const url = new URL(request.url);
    const text = await request.text();
    const call: RecordedCall = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: text ? parseBody(text) : undefined,
      headers: request.headers,
    };
    calls.push(call);
    const handler = handlers.get(`${call.method} ${call.path}`);
    if (handler === undefined) {
      throw new Error(`Unexpected request: ${call.method} ${call.path}`);
    }
    const reply = typeof handler === 'function' ? await handler(call) : handler;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    /** Calls to one endpoint, e.g. callsTo('POST /api/auth/login'). */
    callsTo: (route: string) => calls.filter((c) => `${c.method} ${c.path}` === route),
  };
}

/** JSON bodies are parsed; anything else (e.g. recorded audio) is kept as text. */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
