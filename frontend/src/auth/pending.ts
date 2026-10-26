/**
 * Verifying an email needs the account password as well as the code. Right after signing up (or
 * after a login that says "verify your email first") we remember the password here, in memory
 * only, so the verify screen doesn't ask for it again. It is never written to storage or to router
 * state (browsers persist history state to disk), and is gone after a page reload.
 */
let pending: { email: string; password: string } | null = null;

export function rememberPendingSignup(email: string, password: string): void {
  pending = { email: email.trim().toLowerCase(), password };
}

export function pendingPasswordFor(email: string): string | null {
  return pending && pending.email === email.trim().toLowerCase() ? pending.password : null;
}

export function pendingEmail(): string | null {
  return pending?.email ?? null;
}

export function forgetPendingSignup(): void {
  pending = null;
}
