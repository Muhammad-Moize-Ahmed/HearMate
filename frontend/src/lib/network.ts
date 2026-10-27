/**
 * Online or offline, from one source: TanStack Query's `onlineManager`. Queries pause while it says
 * offline and refetch when it says online again, so the banner and the data always agree.
 *
 * The manager follows the browser's `online`/`offline` events but starts out assuming "online";
 * `syncWithBrowser` corrects that when the app is opened without a connection.
 */
import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';

export function syncWithBrowser(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    onlineManager.setOnline(navigator.onLine);
  }
}

export function isOnline(): boolean {
  return onlineManager.isOnline();
}

/** Call `listener` with the new state whenever the connection drops or comes back. */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  return onlineManager.subscribe(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

/** True for a few seconds after the connection comes back, to say "Back online". */
export function useBackOnline(showForMs = 3000): boolean {
  const [back, setBack] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribeOnline((online) => {
      clearTimeout(timer);
      setBack(online);
      if (online) timer = setTimeout(() => setBack(false), showForMs);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [showForMs]);

  return back;
}
