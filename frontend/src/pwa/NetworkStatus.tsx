import { useAuth } from '../auth/context';
import { useGameActive } from '../lib/gameActivity';
import { useBackOnline, useOnline } from '../lib/network';

/**
 * The app-wide online/offline indicator. Adults are told their pages refresh by themselves when
 * the connection is back (queries pause offline and refetch on reconnect); children get a short,
 * friendly line. During a game the player shows its own "reconnecting" screen instead.
 */
export function NetworkStatus() {
  const online = useOnline();
  const back = useBackOnline();
  const inGame = useGameActive();
  const auth = useAuth();
  const child = auth.status === 'signed-in' && auth.principal.kind === 'child';

  let message: string | null = null;
  let emoji = '';
  if (!online) {
    emoji = '📡';
    message = child
      ? 'No internet right now. Ask a grown-up to check the Wi-Fi.'
      : "You're offline. This page will update by itself when you're back online.";
  } else if (back) {
    emoji = '✅';
    message = 'Back online';
  }

  // The live region stays in the page, so screen readers announce the change.
  return (
    <div role="status" className="contents">
      {message && !inGame && (
        <p
          className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-4 py-2 font-bold shadow-lg ${
            online ? 'bg-mint-200 text-emerald-950' : 'bg-ink text-white'
          }`}
        >
          <span aria-hidden="true">{emoji}</span>
          {message}
        </p>
      )}
    </div>
  );
}
