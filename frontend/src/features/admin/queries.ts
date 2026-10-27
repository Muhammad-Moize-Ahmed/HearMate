import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

type S = components['schemas'];
export type Therapist = S['TherapistOut'];
export type ApprovalStatus = S['TherapistApprovalStatus'];
export type AdminUser = S['AdminUserOut'];
export type Stats = S['AdminStatsOut'];
export type UserRole = S['UserRole'];
export type UserStatus = S['UserStatus'];

export type UserQuery = {
  q: string;
  role: UserRole | null;
  status: UserStatus | null;
  limit: number;
  offset: number;
};

export const adminKeys = {
  all: ['admin'] as const,
  therapists: ['admin', 'therapists'] as const,
  stats: ['admin', 'stats'] as const,
  users: (query: UserQuery) => ['admin', 'users', query] as const,
};

/** Every therapist account, oldest first. Counts and filters are worked out from this list. */
export function useTherapists() {
  return useQuery({
    queryKey: adminKeys.therapists,
    queryFn: () => unwrap(api.GET('/api/admin/therapists')),
  });
}

/** Counts for the dashboard: accounts, children and recent games. No personal details. */
export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats,
    queryFn: () => unwrap(api.GET('/api/admin/stats')),
  });
}

/** One page of adult accounts, newest first. Children are never listed, only counted. */
export function useAdminUsers(query: UserQuery) {
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () =>
      unwrap(
        api.GET('/api/admin/users', {
          params: {
            query: {
              ...(query.q && { q: query.q }),
              ...(query.role && { role: query.role }),
              ...(query.status && { status: query.status }),
              limit: query.limit,
              offset: query.offset,
            },
          },
        }),
      ),
    // Paging or filtering keeps the current rows on screen until the next ones arrive.
    placeholderData: keepPreviousData,
  });
}

/**
 * Put the updated account into the list straight away, then refetch everything admin (the counts
 * and the account list show approval status too).
 */
function useSaved() {
  const queryClient = useQueryClient();
  return (updated: Therapist) => {
    queryClient.setQueryData<Therapist[]>(adminKeys.therapists, (list) =>
      list?.map((t) => (t.id === updated.id ? updated : t)),
    );
    void queryClient.invalidateQueries({ queryKey: adminKeys.all });
  };
}

export function useApproveTherapist() {
  const saved = useSaved();
  return useMutation({
    mutationFn: (therapistId: string) =>
      unwrap(
        api.POST('/api/admin/therapists/{therapist_id}/approve', {
          params: { path: { therapist_id: therapistId } },
        }),
      ),
    onSuccess: saved,
  });
}

export function useRejectTherapist() {
  const saved = useSaved();
  return useMutation({
    mutationFn: ({ therapistId, reason }: { therapistId: string; reason: string }) =>
      unwrap(
        api.POST('/api/admin/therapists/{therapist_id}/reject', {
          params: { path: { therapist_id: therapistId } },
          body: { reason },
        }),
      ),
    onSuccess: saved,
  });
}
