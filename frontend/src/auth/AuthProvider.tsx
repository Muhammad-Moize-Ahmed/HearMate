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
import { isOnline, subscribeOnline } from '../lib/network';
import { clearUserCaches } from '../pwa/caches';
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

  // Data cached for one account must never be shown to the next one: not in memory, and not in
  // any Cache Storage the app can reach (the service worker's precache holds only the build).
  const forgetCachedData = useCallback(() => {
    queryClient.clear();
    clearUserCaches().catch(() => undefined);
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    let stopWaiting = () => {};
    const attempt = () => {
      void restoreSession().then((reached) => {
        if (!active) return;
        // Opened offline (e.g. the installed app with no signal): don't send the user to sign in.
        // Keep waiting, and try again as soon as the connection is back.
        if (!reached && !isOnline()) {
          stopWaiting = subscribeOnline((online) => {
            if (!online) return;
            stopWaiting();
            attempt();
          });
          return;
        }
        // No sign-in after all (expired, revoked, or the server refused): signed out right away,
        // with nothing left over from before.
        if (getSession() === null) forgetCachedData();
        setRestored(true);
      });
    };
    attempt();
    return () => {
      active = false;
      stopWaiting();
    };
  }, [forgetCachedData]);

  useEffect(() => {
    if (session === null) forgetCachedData();
  }, [session, forgetCachedData]);

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
