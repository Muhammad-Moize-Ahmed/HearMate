import { Navigate, Outlet, useLocation } from 'react-router';

import { FullPageSpinner } from '../components/ui/Spinner';
import { useAuth } from './context';
import { afterSignInPath, homePath, readAuthState, type AuthLocationState } from './routing';
import type { PrincipalKind } from './session';

/** Only these kinds of account may open the nested routes; others go to their own home. */
export function RequireRole({ kinds }: { kinds: readonly PrincipalKind[] }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return <FullPageSpinner />;
  }
  if (auth.status === 'signed-out') {
    const state: AuthLocationState = { from: location.pathname + location.search };
    const loginPath = kinds.length === 1 && kinds[0] === 'child' ? '/login?as=child' : '/login';
    return <Navigate to={loginPath} replace state={state} />;
  }
  if (!kinds.includes(auth.principal.kind)) {
    return <Navigate to={homePath(auth.principal.kind)} replace />;
  }
  return <Outlet />;
}

/**
 * Sign-in screens. Once a session starts (on any of them), this sends the user on: back to the page
 * they came from, or to their home. Screens therefore only call `signIn` and never navigate.
 */
export function PublicOnly() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return <FullPageSpinner />;
  }
  if (auth.status === 'signed-in') {
    const { from } = readAuthState(location.state);
    return <Navigate to={afterSignInPath(auth.principal.kind, from)} replace />;
  }
  return <Outlet />;
}
