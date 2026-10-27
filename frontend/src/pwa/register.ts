/**
 * Registers the service worker. main.tsx loads this only in a production build, so `pnpm dev`
 * never has a worker (and HMR keeps working).
 */
import { registerSW } from 'virtual:pwa-register';

import { isOnline } from '../lib/network';
import { updates } from './updates';

/** Browsers look for a new worker on navigation; a single-page app rarely navigates, so ask too. */
const CHECK_EVERY_MS = 60 * 60_000;

export function registerServiceWorker(): void {
  const activate = registerSW({
    onNeedRefresh: () => updates.waiting(),
    // Replaces the plugin's own `location.reload()`: updates.ts decides when reloading is safe.
    onNeedReload: () => updates.tookOver(),
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      setInterval(() => {
        if (isOnline()) registration.update().catch(() => undefined);
      }, CHECK_EVERY_MS);
    },
  });
  updates.connect(() => void activate());
}
