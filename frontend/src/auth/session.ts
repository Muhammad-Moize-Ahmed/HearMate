/**
 * The signed-in session, kept in memory only (never localStorage).
 *
 * The access token lives here for its 15 minutes. The refresh token is an httpOnly cookie the
 * page can't read; `refreshSession()` swaps it for a new access token *and* a new cookie.
 *
 * The backend treats a refresh token presented twice as stolen and ends the whole sign-in, so
 * refreshes must never overlap: within a tab they share one in-flight request, and across tabs
 * they take turns through a Web Lock (each tab then sends the newest cookie).
 */
import { toApiError } from '../api/errors';
import { API_ORIGIN } from '../api/http';
import type { components } from '../api/schema';

export type Principal = components['schemas']['UserMeOut'] | components['schemas']['ChildMeOut'];
export type PrincipalKind = Principal['kind'];
type TokenOut = components['schemas']['TokenOut'];

export type Session = { accessToken: string; expiresAt: number; principal: Principal };
/**
 * Why there is no session: never signed in / signed out on purpose, the sign-in expired, or the
 * account was just deleted.
 */
export type EndReason = 'signed-out' | 'expired' | 'deleted';

/** Refresh a little before the token expires rather than wait for a 401. */
const EXPIRY_MARGIN_MS = 30_000;
const REFRESH_LOCK = 'hearmate-refresh';

let session: Session | null = null;
let endReason: EndReason = 'signed-out';
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getSession(): Session | null {
  return session;
}

export function getEndReason(): EndReason {
  return endReason;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startSession(tokens: TokenOut): Session {
  session = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    principal: tokens.principal,
  };
  emit();
  return session;
}

export function endSession(reason: EndReason = 'signed-out'): void {
  session = null;
  endReason = reason;
  emit();
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK, task);
  }
  return task();
}

let inFlight: Promise<Session | null> | null = null;

/**
 * Exchange the refresh cookie for a new session. Resolves to null when there is no valid sign-in
 * (and ends the session); throws on network or server errors, leaving the session alone.
 */
export function refreshSession(): Promise<Session | null> {
  inFlight ??= withRefreshLock(async () => {
    const response = await globalThis.fetch(`${API_ORIGIN}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 401) {
      endSession(session ? 'expired' : 'signed-out');
      return null;
    }
    if (!response.ok) {
      throw toApiError(response, body);
    }
    return startSession(body as TokenOut);
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let restoring: Promise<boolean> | null = null;

/**
 * On page load: pick up an existing sign-in from the cookie. Runs once, however often called.
 * Resolves false when the server couldn't be reached (offline or down); a later call tries again.
 */
export function restoreSession(): Promise<boolean> {
  restoring ??= refreshSession().then(
    () => true,
    () => {
      restoring = null;
      return false;
    },
  );
  return restoring;
}

function withToken(request: Request, current: Session | null): Request {
  if (current) {
    request.headers.set('Authorization', `Bearer ${current.accessToken}`);
  }
  return request;
}

/**
 * `fetch` for the authenticated API client: adds the access token, refreshes it when it is about to
 * expire, and on a 401 refreshes once and retries the request.
 */
export async function authFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  let current = session;
  if (current && current.expiresAt - Date.now() < EXPIRY_MARGIN_MS) {
    current = await refreshSession();
  }
  const response = await globalThis.fetch(withToken(request, current));
  if (response.status !== 401 || current === null) {
    return response;
  }
  const renewed = await refreshSession();
  return renewed ? globalThis.fetch(withToken(retry, renewed)) : response;
}

/** Test helper: forget everything, as on a fresh page load. */
export function resetSessionForTests(): void {
  session = null;
  endReason = 'signed-out';
  inFlight = null;
  restoring = null;
  listeners.clear();
}
