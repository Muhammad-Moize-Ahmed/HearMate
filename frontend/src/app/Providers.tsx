import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AuthProvider } from '../auth/AuthProvider';
import { AppNotices } from '../pwa/AppNotices';

export function Providers({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <AppNotices />
      </AuthProvider>
    </QueryClientProvider>
  );
}
