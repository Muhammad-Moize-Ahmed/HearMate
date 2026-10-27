import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { api, unwrap } from '../../api/client';

export const accountKeys = { deletionSummary: ['account', 'deletion-summary'] as const };

export function useDeletionSummary() {
  return useQuery({
    queryKey: accountKeys.deletionSummary,
    queryFn: () => unwrap(api.GET('/api/account/deletion-summary')),
    staleTime: 0, // the counts must be current when someone is about to delete
  });
}

/**
 * Delete the signed-in account. On success the server has already ended every session and
 * cleared the refresh cookie. The goodbye page then ends the in-memory session, once it is on
 * screen (see AccountDeletedPage); ending it here, while the role-guarded page is still shown,
 * would let the guard send the user to sign in instead.
 */
export function useDeleteAccount() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(api.POST('/api/account/delete', { body: { password } })),
    onSuccess: () => {
      const state: AccountDeletedState = { deleted: true };
      void navigate('/account-deleted', { replace: true, state });
    },
  });
}

/** Router state for the goodbye page; only a deletion sets it (a link or a reload can't). */
export type AccountDeletedState = { deleted?: boolean };
