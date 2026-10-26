import type { PrincipalKind } from './session';

const HOME: Record<PrincipalKind, string> = {
  parent: '/parent',
  therapist: '/therapist',
  admin: '/admin',
  child: '/play',
};

export function homePath(kind: PrincipalKind): string {
  return HOME[kind];
}

/**
 * Where to go after signing in: back to the page that sent the user to the login screen, if it is
 * an in-app path this account may open; otherwise the account's home.
 */
export function afterSignInPath(kind: PrincipalKind, from: unknown): string {
  const home = homePath(kind);
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) {
    return home;
  }
  return from === home || from.startsWith(`${home}/`) || from.startsWith(`${home}?`) ? from : home;
}

/** Router state that auth screens pass to each other. */
export type AuthLocationState = {
  /** The page to return to after signing in. */
  from?: string;
  /** Pre-fill the email field. */
  email?: string;
  /** A one-off message for the login screen. */
  notice?: 'password-reset';
};

export function readAuthState(state: unknown): AuthLocationState {
  if (typeof state !== 'object' || state === null) return {};
  const { from, email, notice } = state as Record<string, unknown>;
  return {
    from: typeof from === 'string' ? from : undefined,
    email: typeof email === 'string' ? email : undefined,
    notice: notice === 'password-reset' ? notice : undefined,
  };
}
