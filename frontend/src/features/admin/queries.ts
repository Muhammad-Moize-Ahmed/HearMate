import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

export type Therapist = components['schemas']['TherapistOut'];
export type ApprovalStatus = components['schemas']['TherapistApprovalStatus'];

export const adminKeys = { therapists: ['admin', 'therapists'] as const };

/** Every therapist account, oldest first. Counts and filters are worked out from this list. */
export function useTherapists() {
  return useQuery({
    queryKey: adminKeys.therapists,
    queryFn: () => unwrap(api.GET('/api/admin/therapists')),
  });
}

/** Put the updated account into the list straight away, then refetch to be sure. */
function useSaved() {
  const queryClient = useQueryClient();
  return (updated: Therapist) => {
    queryClient.setQueryData<Therapist[]>(adminKeys.therapists, (list) =>
      list?.map((t) => (t.id === updated.id ? updated : t)),
    );
    void queryClient.invalidateQueries({ queryKey: adminKeys.therapists });
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
