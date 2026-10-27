import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, unwrap } from '../../api/client';
import type { components } from '../../api/schema';
import { rangeQuery, type Range } from './range';

type S = components['schemas'];
export type Summary = S['ProgressSummaryOut'];
export type Report = S['ChildReportOut'];
export type Achievement = S['AchievementOut'];
export type PersonalBest = S['PersonalBestOut'];

export const progressKeys = {
  summary: (childId: string, range: Range) =>
    ['children', childId, 'progress', rangeQuery(range)] as const,
  trend: (childId: string, range: Range) =>
    ['children', childId, 'trend', rangeQuery(range)] as const,
  report: (childId: string, range: Range) =>
    ['children', childId, 'report', rangeQuery(range)] as const,
  achievements: (childId: string) => ['children', childId, 'achievements'] as const,
  bests: (childId: string) => ['children', childId, 'personal-bests'] as const,
};

const request = (childId: string, range: Range) => ({
  params: { path: { child_id: childId }, query: rangeQuery(range) },
});

// Changing the period keeps the old numbers on screen until the new ones arrive.
const keepWhileChanging = { placeholderData: keepPreviousData };

export function useSummary(childId: string, range: Range) {
  return useQuery({
    queryKey: progressKeys.summary(childId, range),
    queryFn: () => unwrap(api.GET('/api/children/{child_id}/progress', request(childId, range))),
    ...keepWhileChanging,
  });
}

/** One entry per day of the period, oldest first. */
export function useTrend(childId: string, range: Range) {
  return useQuery({
    queryKey: progressKeys.trend(childId, range),
    queryFn: () =>
      unwrap(api.GET('/api/children/{child_id}/progress/trend', request(childId, range))),
    ...keepWhileChanging,
  });
}

/** The detailed report; for parents and linked therapists only (children get a 403). */
export function useReport(childId: string, range: Range) {
  return useQuery({
    queryKey: progressKeys.report(childId, range),
    queryFn: () => unwrap(api.GET('/api/children/{child_id}/report', request(childId, range))),
    ...keepWhileChanging,
  });
}

export function useAchievements(childId: string) {
  return useQuery({
    queryKey: progressKeys.achievements(childId),
    queryFn: () =>
      unwrap(
        api.GET('/api/children/{child_id}/achievements', {
          params: { path: { child_id: childId } },
        }),
      ),
  });
}

export function usePersonalBests(childId: string) {
  return useQuery({
    queryKey: progressKeys.bests(childId),
    queryFn: () =>
      unwrap(
        api.GET('/api/children/{child_id}/personal-bests', {
          params: { path: { child_id: childId } },
        }),
      ),
  });
}
