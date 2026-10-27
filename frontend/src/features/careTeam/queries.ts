import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

type S = components['schemas'];
export type ParentLink = S['ParentLinkOut'];
export type TherapistLink = S['TherapistLinkOut'];

export const careTeamKeys = {
  forChild: (childId: string) => ['children', childId, 'therapists'] as const,
  mine: ['therapist-links'] as const,
};

const path = (childId: string) => ({ params: { path: { child_id: childId } } });

// ------------------------------------------------------------------ parent side

/** Therapists invited to or following one child (pending and active links). */
export function useChildTherapists(childId: string) {
  return useQuery({
    queryKey: careTeamKeys.forChild(childId),
    queryFn: () => unwrap(api.GET('/api/children/{child_id}/therapists', path(childId))),
  });
}

// Not awaited: the caller's own onSuccess must run before the refetch removes a revoked card.
function useRefreshChildTherapists(childId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: careTeamKeys.forChild(childId) });
  };
}

export function useInviteTherapist(childId: string) {
  const refresh = useRefreshChildTherapists(childId);
  return useMutation({
    mutationFn: (email: string) =>
      unwrap(
        api.POST('/api/children/{child_id}/therapists', { ...path(childId), body: { email } }),
      ),
    onSuccess: refresh,
  });
}

/** Cancel an invitation or remove a therapist's access. */
export function useRevokeTherapist(childId: string) {
  const refresh = useRefreshChildTherapists(childId);
  return useMutation({
    mutationFn: (linkId: string) =>
      unwrap(
        api.DELETE('/api/children/{child_id}/therapists/{link_id}', {
          params: { path: { child_id: childId, link_id: linkId } },
        }),
      ),
    onSuccess: refresh,
  });
}

// ------------------------------------------------------------------ therapist side

/** The therapist's invitations and the children they follow (pending and active). */
export function useMyLinks({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: careTeamKeys.mine,
    queryFn: () => unwrap(api.GET('/api/therapist/links')),
    enabled,
  });
}

function useRefreshMyLinks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: careTeamKeys.mine });
    // `GET /children` lists a therapist's linked children, so it changes too.
    void queryClient.invalidateQueries({ queryKey: ['children'], exact: true });
  };
}

export function useAcceptInvitation() {
  const refresh = useRefreshMyLinks();
  return useMutation({
    mutationFn: (linkId: string) =>
      unwrap(
        api.POST('/api/therapist/links/{link_id}/accept', {
          params: { path: { link_id: linkId } },
        }),
      ),
    onSuccess: refresh,
  });
}

/** Decline an invitation or stop following a child. */
export function useLeaveLink() {
  const refresh = useRefreshMyLinks();
  return useMutation({
    mutationFn: (linkId: string) =>
      unwrap(
        api.DELETE('/api/therapist/links/{link_id}', { params: { path: { link_id: linkId } } }),
      ),
    onSuccess: refresh,
  });
}
