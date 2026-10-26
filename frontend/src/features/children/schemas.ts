import { z } from 'zod';

import type { components } from '../../api/schema';
import { ageInYears, todayISO } from '../../lib/dates';
import {
  ATTENTION_LABELS,
  AVATAR_LABELS,
  ENVIRONMENT_LABELS,
  FOCUS_LABELS,
  GENDER_LABELS,
  HEARING_LABELS,
  INTEREST_LABELS,
  keysOf,
  LEARNING_STYLE_LABELS,
  SPEECH_LABELS,
} from './options';

/** Client-side checks that mirror the backend (app/modules/children/schemas.py). */
const MAX_CHILD_AGE_YEARS = 18;

/** An optional single choice: "" in the form means "not set" (null in the API). */
const optional = <V extends string>(labels: Record<V, unknown>) =>
  z.union([z.enum(keysOf(labels)), z.literal('')]);

export const childSchema = z.object({
  display_name: z.string().trim().min(1, 'Please enter a name.').max(100, 'That name is too long.'),
  date_of_birth: z
    .string()
    .min(1, 'Please enter their date of birth.')
    .refine((value) => value <= todayISO(), "That date hasn't happened yet.")
    .refine(
      (value) => ageInYears(value) < MAX_CHILD_AGE_YEARS,
      `HearMate is for children under ${MAX_CHILD_AGE_YEARS}.`,
    ),
  avatar: z.enum(keysOf(AVATAR_LABELS)),
  gender: optional(GENDER_LABELS),
  hearing_difficulties: z.array(z.enum(keysOf(HEARING_LABELS))),
  speech_challenges: z.array(z.enum(keysOf(SPEECH_LABELS))),
  focus_areas: z.array(z.enum(keysOf(FOCUS_LABELS))),
  interests: z.array(z.enum(keysOf(INTEREST_LABELS))),
  learning_environment: optional(ENVIRONMENT_LABELS),
  attention_span: optional(ATTENTION_LABELS),
  preferred_learning_style: optional(LEARNING_STYLE_LABELS),
  session_length_minutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
  ]),
  notes: z.string().trim().max(2000, 'Please keep notes under 2,000 characters.'),
  timezone: z.string(),
});

export type ChildFormValues = z.input<typeof childSchema>;
type ChildBody = components['schemas']['ChildCreateIn'];

/** Form values -> API body. Every field is sent, so the same body works for create and update. */
export function toChildBody(values: z.output<typeof childSchema>): ChildBody {
  return {
    ...values,
    gender: values.gender || null,
    learning_environment: values.learning_environment || null,
    attention_span: values.attention_span || null,
    preferred_learning_style: values.preferred_learning_style || null,
    session_length_minutes: values.session_length_minutes || null,
    notes: values.notes || null,
    timezone: values.timezone || null,
  };
}

/** PINs that are too easy to guess: all the same digit, or counting up or down by one. */
function isTrivialPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]!));
  return new Set(digits).size === 1 || (steps.size === 1 && (steps.has(1) || steps.has(-1)));
}

export const childLoginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9._-]{2,29}$/,
        'Use 3 to 30 letters or numbers, starting with a letter. Dots, dashes and underscores are fine.',
      ),
    pin: z
      .string()
      .regex(/^\d{4,8}$/, 'A PIN is 4 to 8 numbers.')
      .refine(
        (pin) => !isTrivialPin(pin),
        'Pick a PIN that is harder to guess (not 1111 or 1234).',
      ),
    confirm: z.string(),
  })
  .refine((v) => v.pin === v.confirm, { path: ['confirm'], message: "The PINs don't match." });

/** A username suggestion from the child's name ("Ali Khan" -> "alikhan"). */
export function suggestUsername(displayName: string): string {
  const slug = displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  return slug.slice(0, 30);
}
