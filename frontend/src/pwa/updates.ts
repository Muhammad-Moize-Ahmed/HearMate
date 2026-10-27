/**
 * New versions of the app. When a deploy ships a new service worker, it installs in the background
 * and waits; the page shows "A new version is ready — Refresh" (UpdatePrompt).
 *
 * The page reloads only right after the user taps Refresh in this tab, and never while a game is
 * in progress. If another tab applies the update, this tab doesn't reload: it shows the prompt
 * instead, so a game or a half-filled form here is never thrown away.
 */
import { useSyncExternalStore } from 'react';

import { isGameActive } from '../lib/gameActivity';

type Deps = {
  reload: () => void;
  /** True while reloading would interrupt something (a game). */
  isBusy: () => boolean;
};

export function createUpdates({ reload, isBusy }: Deps) {
  let ready = false;
  let dismissed = false;
  let takenOver = false;
  let userAsked = false;
  let skipWaiting: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    /** The registration hands over how to activate the waiting worker. */
    connect(activate: () => void) {
      skipWaiting = activate;
    },
    /** A new version is installed and waiting. */
    waiting() {
      ready = true;
      dismissed = false;
      emit();
    },
    /** The new version has taken control of this tab (after Refresh here or in another tab). */
    tookOver() {
      takenOver = true;
      if (userAsked && !isBusy()) {
        reload();
        return;
      }
      userAsked = false;
      ready = true;
      dismissed = false;
      emit();
    },
    /** "Refresh": switch to the new version, then reload. */
    apply() {
      if (isBusy()) return;
      if (takenOver || skipWaiting === null) {
        reload();
        return;
      }
      userAsked = true;
      skipWaiting();
    },
    /** "Later": hide the prompt until the next version (or this one takes over). */
    dismiss() {
      dismissed = true;
      emit();
    },
    isReady: () => ready && !dismissed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Updates = ReturnType<typeof createUpdates>;

export const updates: Updates = createUpdates({
  reload: () => window.location.reload(),
  isBusy: isGameActive,
});

export function useUpdateReady(store: Updates = updates): boolean {
  return useSyncExternalStore(store.subscribe, store.isReady, () => false);
}
