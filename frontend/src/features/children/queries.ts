import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components, paths } from '../../api/schema';

export type Child = components['schemas']['ChildOut'];
type ChildBody = components['schemas']['ChildCreateIn'];
// Two backend schemas are named ChildLoginIn, so take this one from its endpoint.
type LoginBody =
  paths['/api/children/{child_id}/login']['put']['requestBody']['content']['application/json'];

export const childKeys = {
  list: ['children'] as const,
  detail: (id: string) => ['children', id] as const,
  family: ['family-progress'] as const,
};

const path = (childId: string) => ({ params: { path: { child_id: childId } } });

export function useChildren() {
  return useQuery({ queryKey: childKeys.list, queryFn: () => unwrap(api.GET('/api/children')) });
}

export function useChild(childId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: childKeys.detail(childId),
    queryFn: () => unwrap(api.GET('/api/children/{child_id}', path(childId))),
    enabled,
  });
}

/** This week's sessions, minutes, streak and badges for each child. */
export function useFamilyProgress() {
  return useQuery({
    queryKey: childKeys.family,
    queryFn: () => unwrap(api.GET('/api/family/progress')),
  });
}

/** After any change to a child: store the new copy and refresh the lists that show it. */
function useChildSaved() {
  const queryClient = useQueryClient();
  return (child: Child) => {
    queryClient.setQueryData(childKeys.detail(child.id), child);
    void queryClient.invalidateQueries({ queryKey: childKeys.list, exact: true });
    void queryClient.invalidateQueries({ queryKey: childKeys.family });
  };
}

export function useCreateChild() {
  const saved = useChildSaved();
  return useMutation({
    mutationFn: (body: ChildBody) => unwrap(api.POST('/api/children', { body })),
    onSuccess: saved,
  });
}

export function useUpdateChild(childId: string) {
  const saved = useChildSaved();
  return useMutation({
    mutationFn: (body: ChildBody) =>
      unwrap(api.PATCH('/api/children/{child_id}', { ...path(childId), body })),
    onSuccess: saved,
  });
}

/** Delete a child for good. The parent's password is asked for again. */
export function useDeleteChild(childId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(api.POST('/api/children/{child_id}/delete', { ...path(childId), body: { password } })),
    onSuccess: () => {
      // Nothing about the child stays in memory: their profile and every query under it.
      queryClient.removeQueries({ queryKey: childKeys.detail(childId) });
      void queryClient.invalidateQueries({ queryKey: childKeys.list, exact: true });
      void queryClient.invalidateQueries({ queryKey: childKeys.family });
    },
  });
}

export function useSetChildLogin(childId: string) {
  const saved = useChildSaved();
  return useMutation({
    mutationFn: (body: LoginBody) =>
      unwrap(api.PUT('/api/children/{child_id}/login', { ...path(childId), body })),
    onSuccess: saved,
  });
}

export function useRemoveChildLogin(childId: string) {
  const saved = useChildSaved();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/children/{child_id}/login', path(childId))),
    onSuccess: saved,
  });
}
