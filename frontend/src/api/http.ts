import createClient from 'openapi-fetch';

import type { paths } from './schema';

/**
 * The API is always same-origin (`/api/...`): Vite proxies it in development, and a reverse proxy
 * does in production, so no backend host is ever hardcoded. Paths in the schema include `/api`.
 */
export const API_ORIGIN = window.location.origin;

/**
 * Client for the sign-in endpoints (`/api/auth/...`). It never adds a token and never retries:
 * retrying a failed login would count twice towards the account lockout.
 */
export const publicApi = createClient<paths>({
  baseUrl: API_ORIGIN,
  // Looked up per call (not captured once), so tests can stub `fetch`.
  fetch: (request) => globalThis.fetch(request),
});
