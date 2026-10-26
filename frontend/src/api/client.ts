import createClient from 'openapi-fetch';

import { authFetch } from '../auth/session';
import { API_ORIGIN } from './http';
import type { paths } from './schema';

export { publicApi } from './http';
export { ApiError, describeError, unwrap } from './errors';

/** Client for every authenticated endpoint: sends the access token and renews it when needed. */
export const api = createClient<paths>({ baseUrl: API_ORIGIN, fetch: authFetch });
