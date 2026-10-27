import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '../api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx won't change by asking again; network blips and 5xx get two more tries.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        staleTime: 30_000,
      },
      // Offline, a change fails straight away with "check your connection" instead of waiting in a
      // hidden queue and being sent later without the user knowing.
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
