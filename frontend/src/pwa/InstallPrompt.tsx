import { useState } from 'react';
import { useLocation } from 'react-router';

import { useAuth } from '../auth/context';
import { Button } from '../components/ui/Button';
import {
  installPromptMode,
  isIosSafari,
  isStandalone,
  promptInstall,
  rememberDismissed,
  useCanPromptInstall,
  wasDismissed,
} from './install';

/** A small, dismissible "Install app" card for parents. The rules are in `installPromptMode`. */
export function InstallPrompt() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const canPrompt = useCanPromptInstall();
  const [dismissed, setDismissed] = useState(() => wasDismissed());

  const mode = installPromptMode({
    kind: auth.status === 'signed-in' ? auth.principal.kind : null,
    pathname,
    standalone: isStandalone(),
    dismissed,
    canPrompt,
    iosSafari: isIosSafari(),
  });
  if (mode === null) return null;

  const dismiss = () => {
    rememberDismissed();
    setDismissed(true);
  };

  return (
    <aside
      aria-label="Install HearMate"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-2 ring-brand-100 print:hidden sm:flex-nowrap"
    >
      <img src="/icons/icon-192.png" alt="" className="size-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Install HearMate on this device</p>
        {mode === 'native' ? (
          <p className="text-ink-soft">It opens from your home screen, like any other app.</p>
        ) : (
          <p className="text-ink-soft">
            In Safari, tap <span className="font-bold">Share</span> <ShareIcon />, then{' '}
            <span className="font-bold">Add to Home Screen</span>.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={dismiss}>
          Not now
        </Button>
        {mode === 'native' && (
          <Button
            onClick={() =>
              void promptInstall().then((installed) => {
                if (!installed) dismiss();
              })
            }
          >
            Install
          </Button>
        )}
      </div>
    </aside>
  );
}

/** The iOS share symbol (a box with an arrow up), so parents know which button to look for. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline size-5 align-text-bottom text-brand-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
