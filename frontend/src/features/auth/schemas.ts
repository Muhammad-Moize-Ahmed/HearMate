import { z } from 'zod';

/** Client-side checks that mirror the backend (app/modules/auth/schemas.py). */
export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

const email = z
  .string()
  .trim()
  .min(1, 'Please enter your email address.')
  .pipe(z.email("That doesn't look like an email address."));

// Existing passwords are only length-capped; new ones need at least 10 characters.
const password = z
  .string()
  .min(1, 'Please enter your password.')
  .max(MAX_PASSWORD_LENGTH, 'That password is too long.');

const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`);

const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code is the 6 numbers from the email.');

const name = z.string().trim().min(1, 'Please fill this in.').max(100, 'That is too long.');
const optionalText = z.string().trim().max(200, 'That is too long.');

const passwordsMatch = {
  check: (v: { password: string; confirm: string }) => v.password === v.confirm,
  params: { path: ['confirm'], message: "The passwords don't match." },
};

export const loginSchema = z.object({ email, password });

export const childLoginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Your name has at least 3 letters.')
    .max(50, 'That name is too long.'),
  pin: z.string().regex(/^\d{4,8}$/, 'Your PIN is 4 to 8 numbers.'),
});

export const signupSchema = z
  .object({
    role: z.enum(['parent', 'therapist']),
    first_name: name,
    last_name: name,
    email,
    password: newPassword,
    confirm: z.string(),
    license_number: optionalText,
    organization: optionalText,
    specialization: optionalText,
  })
  .refine(passwordsMatch.check, passwordsMatch.params);

export const verifySchema = z.object({
  email,
  code,
  // Only asked for when we don't already hold it from sign-up (see auth/pending.ts).
  password: z.string().max(MAX_PASSWORD_LENGTH),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({ code, password: newPassword, confirm: z.string() })
  .refine(passwordsMatch.check, passwordsMatch.params);
