import { z } from 'zod';

import type { components } from '../../api/schema';
import { todayISO } from '../../lib/dates';

type SkillCategory = components['schemas']['SkillCategory'];

/** What a goal counts: completed games in one skill, or in any. */
export const CATEGORIES: { value: SkillCategory | ''; label: string; emoji: string }[] = [
  { value: '', label: 'Any game', emoji: '🎮' },
  { value: 'listening', label: 'Listening', emoji: '👂' },
  { value: 'speech', label: 'Speaking', emoji: '🗣️' },
  { value: 'memory', label: 'Memory', emoji: '🧠' },
];

/**
 * Mirrors the backend (app/modules/goals/schemas.py). A due date can't be in the past, except a
 * goal's existing one, which may have passed and can be kept as it is.
 */
export function goalSchemaFor(existingDueDate: string | null = null) {
  return z.object({
    title: z.string().trim().min(1, 'Give the goal a name.').max(200, 'That name is too long.'),
    target_value: z
      .number({ error: 'Enter how many games.' })
      .int('Use a whole number.')
      .min(1, 'At least 1 game.')
      .max(1000, 'At most 1,000 games.'),
    category: z.enum(['', 'listening', 'speech', 'memory']),
    due_date: z
      .string()
      .refine(
        (value) => value === '' || value === existingDueDate || value >= todayISO(),
        "The date can't be in the past.",
      ),
    notes: z.string().trim().max(1000, 'Please keep notes under 1,000 characters.'),
  });
}

type GoalSchema = ReturnType<typeof goalSchemaFor>;
export type GoalFormValues = z.input<GoalSchema>;
export type GoalBody = ReturnType<typeof toGoalBody>;

export function toGoalBody(values: z.output<GoalSchema>) {
  return {
    title: values.title,
    target_value: values.target_value,
    category: values.category || null,
    due_date: values.due_date || null,
    notes: values.notes || null,
  };
}
