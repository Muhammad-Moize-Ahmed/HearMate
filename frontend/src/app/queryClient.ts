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
      mutations: { retry: false },
    },
  });
}
