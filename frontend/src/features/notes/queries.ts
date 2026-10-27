import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

export type Note = components['schemas']['NoteOut'];

/** Notes per page; the backend's default. */
export const NOTES_PAGE = 50;

export const noteKeys = { list: (childId: string) => ['children', childId, 'notes'] as const };

/**
 * Therapist notes, newest first, a page at a time. Read by the parent and linked therapists only;
 * a child never asks for them (the backend refuses children too).
 */
export function useNotes(childId: string) {
  return useInfiniteQuery({
    queryKey: noteKeys.list(childId),
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/children/{child_id}/notes', {
          params: {
            path: { child_id: childId },
            query: { limit: NOTES_PAGE, ...(pageParam && { before: pageParam }) },
          },
        }),
      ),
    initialPageParam: '',
    // A full page may have more behind it: ask for notes older than the oldest one we have.
    getNextPageParam: (page) =>
      page.length === NOTES_PAGE ? page[page.length - 1]?.created_at : undefined,
  });
}

function useRefreshNotes(childId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: noteKeys.list(childId) });
}

export function useCreateNote(childId: string) {
  const refresh = useRefreshNotes(childId);
  return useMutation({
    mutationFn: (body: string) =>
      unwrap(
        api.POST('/api/children/{child_id}/notes', {
          params: { path: { child_id: childId } },
          body: { body },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useUpdateNote(childId: string) {
  const refresh = useRefreshNotes(childId);
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      unwrap(
        api.PATCH('/api/children/{child_id}/notes/{note_id}', {
          params: { path: { child_id: childId, note_id: noteId } },
          body: { body },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useDeleteNote(childId: string) {
  const refresh = useRefreshNotes(childId);
  return useMutation({
    mutationFn: (noteId: string) =>
      unwrap(
        api.DELETE('/api/children/{child_id}/notes/{note_id}', {
          params: { path: { child_id: childId, note_id: noteId } },
        }),
      ),
    onSuccess: refresh,
  });
}
