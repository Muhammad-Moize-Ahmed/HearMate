import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { publicApi } from '../api/http';
import { AuthContext, type AuthContextValue, type AuthState } from './context';
import { forgetPendingSignup } from './pending';
import {
  endSession,
  getEndReason,
  getSession,
  restoreSession,
  startSession,
  subscribe,
} from './session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSyncExternalStore(subscribe, getSession);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let active = true;
    void restoreSession().then(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Data cached for one account must never be shown to the next one.
  useEffect(() => {
    if (session === null) queryClient.clear();
  }, [session, queryClient]);

  const signIn = useCallback<AuthContextValue['signIn']>((tokens) => {
    forgetPendingSignup();
    startSession(tokens);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await publicApi.POST('/api/auth/logout');
    } catch {
      // Offline: the cookie stays, but it expires on its own; sign out locally regardless.
    }
    endSession('signed-out');
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    let state: AuthState;
    if (session) {
      state = { status: 'signed-in', principal: session.principal };
    } else if (!restored) {
      state = { status: 'loading' };
    } else {
      state = { status: 'signed-out', reason: getEndReason() };
    }
    return { ...state, signIn, signOut };
  }, [session, restored, signIn, signOut]);

  return <AuthContext value={value}>{children}</AuthContext>;
}
