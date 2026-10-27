import { z } from 'zod';

import type { Game } from '../play/api';
import type { Plan, PlanCreate } from './queries';

export const DIFFICULTIES = [
  { value: '', label: 'Let HearMate decide' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
] as const;

/**
 * Mirrors the backend (app/modules/learning_plans/schemas.py). The form has one row per game;
 * only ticked rows become plan items, so unticked rows are never checked.
 */
const item = z
  .object({
    game: z.string(),
    title: z.string(),
    included: z.boolean(),
    sessions_per_week: z.number(),
    difficulty: z.enum(['', 'easy', 'medium', 'hard']),
    notes: z.string().trim().max(1000, 'Please keep this under 1,000 characters.'),
  })
  .superRefine((row, ctx) => {
    const n = row.sessions_per_week;
    if (row.included && !(Number.isInteger(n) && n >= 1 && n <= 21)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessions_per_week'],
        message: 'Use a whole number from 1 to 21.',
      });
    }
  });

export const planSchema = z.object({
  title: z.string().trim().min(1, 'Give the plan a name.').max(200, 'That name is too long.'),
  notes: z.string().trim().max(5000, 'Please keep notes under 5,000 characters.'),
  items: z.array(item).refine((rows) => rows.filter((r) => r.included).length <= 20, {
    message: 'A plan can have at most 20 games.',
  }),
});

export type PlanFormValues = z.input<typeof planSchema>;

/** One row per catalogue game (plus any game the plan has that left the catalogue). */
export function planFormValues(games: Game[], plan?: Plan): PlanFormValues {
  const chosen = new Map(plan?.items.map((i) => [i.game.slug, i]));
  const rows = games.map((game) => ({ slug: game.slug, title: game.title }));
  for (const i of plan?.items ?? []) {
    if (!games.some((g) => g.slug === i.game.slug)) {
      rows.push({ slug: i.game.slug, title: i.game.title });
    }
  }
  return {
    title: plan?.title ?? '',
    notes: plan?.notes ?? '',
    items: rows.map(({ slug, title }) => {
      const existing = chosen.get(slug);
      return {
        game: slug,
        title,
        included: existing !== undefined,
        sessions_per_week: existing?.sessions_per_week ?? 3,
        difficulty: existing?.difficulty ?? '',
        notes: existing?.notes ?? '',
      };
    }),
  };
}

export function toPlanBody(values: z.output<typeof planSchema>) {
  return {
    title: values.title,
    notes: values.notes || null,
    items: values.items
      .filter((row) => row.included)
      .map((row) => ({
        game: row.game,
        sessions_per_week: row.sessions_per_week,
        difficulty: row.difficulty || null,
        notes: row.notes || null,
      })),
  } satisfies PlanCreate;
}
