import { createContext, useContext } from 'react';

import type { components } from '../api/schema';
import type { EndReason, Principal } from './session';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; reason: EndReason }
  | { status: 'signed-in'; principal: Principal };

export type AuthContextValue = AuthState & {
  /** Start a session from a token response (login, child login, verify email). */
  signIn: (tokens: components['schemas']['TokenOut']) => void;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}

/** For screens that only render when signed in (inside a role guard). */
export function usePrincipal(): Principal {
  const auth = useAuth();
  if (auth.status !== 'signed-in') {
    throw new Error('usePrincipal needs a signed-in user');
  }
  return auth.principal;
}
