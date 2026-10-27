import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { endSession, getSession } from '../../auth/session';
import { LinkButton } from '../../components/ui/Button';
import type { AccountDeletedState } from './queries';

/**
 * After a deletion. Public (outside the role guards), so it can end the in-memory session itself
 * once it is shown: that clears the query cache and Cache Storage (see AuthProvider).
 */
export function AccountDeletedPage() {
  const location = useLocation();
  const justDeleted = (location.state as AccountDeletedState | null)?.deleted === true;

  useEffect(() => {
    if (justDeleted && getSession() !== null) endSession('deleted');
  }, [justDeleted]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-10 text-center">
      <title>Account deleted · HearMate</title>
      <span className="text-6xl" aria-hidden="true">
        👋
      </span>
      <h1 className="text-3xl font-black sm:text-4xl">Your account was deleted</h1>
      <p className="text-lg text-ink-soft">
        Everything has been removed, every device was signed out, and nothing is left on this one.
        We've sent you an email to confirm.
      </p>
      <LinkButton to="/">Back to the home page</LinkButton>
    </div>
  );
}
