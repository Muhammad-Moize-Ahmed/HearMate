/**
 * The installable app: its manifest and service worker (vite-plugin-pwa + Workbox). Used by
 * vite.config.ts, and checked by options.test.ts.
 *
 * The service worker precaches the build only (the app shell and every lazy route's chunk), so
 * the app opens offline. It never stores API responses or audio: `/api` stays network-only, so a
 * shared device keeps nothing about a child, and scoring always happens on the server.
 */
import type { VitePWAOptions } from 'vite-plugin-pwa';

/** The same as `--color-brand-600` and `--color-brand-50` in src/index.css. */
export const THEME_COLOR = '#6d28d9';
export const BACKGROUND_COLOR = '#f5f3ff';

/** API paths: never precached, never served the app shell, never handled by the worker. */
export const API_PATH = /^\/api(\/|$)/;

/**
 * Built files that go into the precache (the plugin adds the manifest itself). Audio is left out on
 * purpose (see above).
 */
const PRECACHE = ['**/*.{js,css,html,svg,png}'];
const NEVER_PRECACHE = ['**/*.{wav,mp3,ogg,oga,m4a,aac,webm,flac}'];

export const pwaOptions: Partial<VitePWAOptions> = {
  // A new version waits until the user taps "Refresh" (src/pwa/updates.ts); nothing reloads on its own.
  registerType: 'prompt',
  // Registered by src/pwa/register.ts, and only in a production build.
  injectRegister: false,
  devOptions: { enabled: false },
  manifest: {
    id: '/',
    name: 'HearMate',
    short_name: 'HearMate',
    description: 'Listening games for children with auditory processing difficulties.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    categories: ['education', 'health'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  // The icons are already matched by `globPatterns`; don't list them twice.
  includeManifestIcons: false,
  workbox: {
    globPatterns: PRECACHE,
    globIgnores: NEVER_PRECACHE,
    // Any page opened offline gets the app shell; the router takes it from there.
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [API_PATH],
    // Nothing is cached at run time: requests that aren't precached go straight to the network.
    runtimeCaching: [],
    // Vite already puts a content hash in these names.
    dontCacheBustURLsMatching: /^assets\//,
    cleanupOutdatedCaches: true,
    // Control the first visit straight away, so it works offline without a reload. Updates still
    // wait for "Refresh": a new worker only takes over after it is told to skip waiting.
    clientsClaim: true,
    skipWaiting: false,
  },
};
