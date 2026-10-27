import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

type S = components['schemas'];
export type Plan = S['LearningPlanOut'];
export type PlanCreate = S['PlanCreateIn'];
export type PlanUpdate = S['PlanUpdateIn'];
export type PlanItemBody = S['PlanItemIn'];

export const planKeys = { list: (childId: string) => ['children', childId, 'plans'] as const };

/**
 * Every learning plan for a child: the active one first, then archived ones, newest first.
 * For the parent and linked therapists only; a child never asks for them.
 */
export function usePlans(childId: string) {
  return useQuery({
    queryKey: planKeys.list(childId),
    queryFn: () =>
      unwrap(
        api.GET('/api/children/{child_id}/learning-plans', {
          params: { path: { child_id: childId } },
        }),
      ),
  });
}

// Refreshed after errors too: a 409 means someone else changed the plans, so show their version.
function useRefreshPlans(childId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: planKeys.list(childId) });
}

/** Start a new plan; it becomes active and the previous one is archived. */
export function useCreatePlan(childId: string) {
  const refresh = useRefreshPlans(childId);
  return useMutation({
    mutationFn: (body: PlanCreate) =>
      unwrap(
        api.POST('/api/children/{child_id}/learning-plans', {
          params: { path: { child_id: childId } },
          body,
        }),
      ),
    onSettled: refresh,
  });
}

export function useUpdatePlan(childId: string) {
  const refresh = useRefreshPlans(childId);
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: PlanUpdate }) =>
      unwrap(
        api.PATCH('/api/children/{child_id}/learning-plans/{plan_id}', {
          params: { path: { child_id: childId, plan_id: planId } },
          body,
        }),
      ),
    onSettled: refresh,
  });
}

/** End the active plan without starting a new one. */
export function useArchivePlan(childId: string) {
  const refresh = useRefreshPlans(childId);
  return useMutation({
    mutationFn: (planId: string) =>
      unwrap(
        api.POST('/api/children/{child_id}/learning-plans/{plan_id}/archive', {
          params: { path: { child_id: childId, plan_id: planId } },
        }),
      ),
    onSettled: refresh,
  });
}
