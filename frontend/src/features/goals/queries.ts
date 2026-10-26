import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

export type Goal = components['schemas']['GoalOut'];
type GoalCreate = components['schemas']['GoalCreateIn'];
type GoalUpdate = components['schemas']['GoalUpdateIn'];

export const goalKeys = { list: (childId: string) => ['children', childId, 'goals'] as const };

export function useGoals(childId: string) {
  return useQuery({
    queryKey: goalKeys.list(childId),
    queryFn: () =>
      unwrap(
        api.GET('/api/children/{child_id}/goals', { params: { path: { child_id: childId } } }),
      ),
  });
}

function useRefreshGoals(childId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: goalKeys.list(childId) });
}

export function useCreateGoal(childId: string) {
  const refresh = useRefreshGoals(childId);
  return useMutation({
    mutationFn: (body: GoalCreate) =>
      unwrap(
        api.POST('/api/children/{child_id}/goals', {
          params: { path: { child_id: childId } },
          body,
        }),
      ),
    onSuccess: refresh,
  });
}

export function useUpdateGoal(childId: string) {
  const refresh = useRefreshGoals(childId);
  return useMutation({
    mutationFn: ({ goalId, body }: { goalId: string; body: GoalUpdate }) =>
      unwrap(
        api.PATCH('/api/children/{child_id}/goals/{goal_id}', {
          params: { path: { child_id: childId, goal_id: goalId } },
          body,
        }),
      ),
    onSuccess: refresh,
  });
}

export function useDeleteGoal(childId: string) {
  const refresh = useRefreshGoals(childId);
  return useMutation({
    mutationFn: (goalId: string) =>
      unwrap(
        api.DELETE('/api/children/{child_id}/goals/{goal_id}', {
          params: { path: { child_id: childId, goal_id: goalId } },
        }),
      ),
    onSuccess: refresh,
  });
}
