# HearMate frontend

React + Vite + TypeScript. Setup, the screen list and the overall architecture are in the
[root README](../README.md); this file covers the installable app (PWA) and offline behaviour.

```bash
pnpm dev          # http://localhost:5173, no service worker, HMR as usual
pnpm test         # Vitest
pnpm build        # type-check + production build (also writes dist/sw.js and the manifest)
pnpm preview      # serve dist/ on http://localhost:4173, service worker active
pnpm icons        # regenerate the placeholder icons in public/icons/
```

## Installable app (PWA)

Built with [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox). All the settings are in
[src/pwa/options.ts](src/pwa/options.ts), and the build checks them in `options.test.ts`.

- **Manifest:** name and short name "HearMate", `display: standalone`, `start_url` and `scope` `/`, theme colour
  `#6d28d9` (brand-600), background `#f5f3ff` (brand-50). It is generated as `manifest.webmanifest` at build time.
- **iPhone/iPad:** `index.html` has the `apple-touch-icon` and the `apple-mobile-web-app-*` tags, plus
  `viewport-fit=cover`. In the installed app the layouts pad themselves with the safe-area insets (the `pt-safe` and
  `pb-safe` utilities in `src/index.css`, and left/right padding on `body`), so nothing sits under the notch or the
  home indicator.
- **Install prompt** ([src/pwa/InstallPrompt.tsx](src/pwa/InstallPrompt.tsx)): a small card at the top of the parent's
  pages. On Android and desktop Chrome/Edge it replays the browser's `beforeinstallprompt`; on iPhone/iPad Safari it
  explains Share → Add to Home Screen. "Not now" hides it for 30 days on that device. It is **never** shown to a child
  (not in `/play/...`, and not to a child's account anywhere), nor to therapists or admins, nor once the app is
  installed. The rules are one function, `installPromptMode` in `src/pwa/install.ts`.

### Icons (placeholders)

They live in [public/icons/](public/icons/) and are drawn by `scripts/generate-icons.mjs` (the Logo's face and
sound waves on brand violet; no dependencies, nothing downloaded).

| File                                   | Size     | Used for                                                                                   |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `icon-192.png`, `icon-512.png`         | 192, 512 | manifest, `purpose: any` (transparent rounded corners)                                     |
| `maskable-192.png`, `maskable-512.png` | 192, 512 | manifest, `purpose: maskable` (full bleed; keep the artwork inside the central 80% circle) |
| `apple-touch-icon.png`                 | 180      | iOS home screen (opaque; iOS rounds the corners)                                           |
| `favicon.svg`, `favicon-32.png`        | any, 32  | browser tab                                                                                |

To use the final artwork, replace these files with the same names and sizes, and stop running `pnpm icons` (it would
overwrite them). The manifest test checks that every icon exists at the size the manifest says.

## Service worker and caching

- **Precached:** the build only, meaning `index.html`, the JS and CSS (including every lazy route's chunk), the icons and
  the manifest. Once a production build has been opened, the app opens offline on that device.
- **Never cached by the worker:** anything under `/api` (it is network-only, and no `runtimeCaching` is configured at
  all), and audio files (excluded from the precache). A shared device therefore keeps nothing about a child in the
  worker's cache, and scoring always happens on the server. Opening an `/api/...` URL directly is never answered
  with the app shell either.
- **Sign-out** (or an expired sign-in): the in-memory query cache is cleared, and every Cache Storage entry except
  Workbox's build precache is deleted ([src/pwa/caches.ts](src/pwa/caches.ts)). The access token was only ever in
  memory.
- **Updates** ([src/pwa/updates.ts](src/pwa/updates.ts)): a new deploy installs in the background and waits. The page
  shows "A new version is ready" with **Refresh** and **Later**. The page reloads only right after the user taps
  Refresh in that tab. If another tab applies the update, this tab shows the prompt instead of reloading. During a
  game the prompt is hidden and Refresh does nothing; it comes back once the game ends. The app also checks for a new
  version every hour while online.
- **Development:** the worker is registered only when `import.meta.env.PROD` is true (`src/main.tsx`) and
  `devOptions` is off, so `pnpm dev` and HMR never involve a service worker. Tests don't load the plugin.

## Offline behaviour

One source of truth: TanStack Query's `onlineManager` ([src/lib/network.ts](src/lib/network.ts)). It follows the
browser's online/offline events and is corrected at start-up if the app opens without a connection.

- **Indicator** ([src/pwa/NetworkStatus.tsx](src/pwa/NetworkStatus.tsx)): a pill at the bottom of every screen
  while offline, then "Back online" for a few seconds. Children get short, friendly wording.
- **Parent, therapist and admin pages:** "You're offline. This page will update by itself when you're back online."
  Queries pause while offline and refetch on reconnect. Changes (saving a form, inviting a therapist and so on) are
  not queued: offline they fail straight away with "check your internet connection" (`networkMode: 'always'` for
  mutations), so nothing is sent later behind the user's back.
- **Opening the installed app offline:** an existing sign-in isn't thrown away. The app waits, with the offline
  pill, and restores the sign-in from the cookie as soon as the connection is back, instead of sending the user to
  the login page. If that refresh fails (the sign-in expired or was revoked), the user is signed out at once and
  cached data is cleared, just as on sign-out.
- **Games** ([src/features/play/useGamePlayer.ts](src/features/play/useGamePlayer.ts)):
  - A game can't start offline. The intro says "We need the internet to play. Ask a grown-up to check the Wi-Fi…"
    instead of showing an error.
  - If the connection drops mid-game, the player pauses and shows "Oops, the internet went away. Your game is
    saved… Reconnecting…". Answers are never queued: nothing is sent while offline.
  - Back online, the session is read again from the server (the same path as resuming after a reload) and play
    carries on from the first unanswered round. An answer the server received just before the drop isn't asked
    again, and a "save my game" that failed is retried.
  - A session named in the URL waits for the connection instead of being given up.

## Testing the PWA locally

The service worker needs a production build. `localhost` counts as a secure origin, so no HTTPS is needed.

1. Start the backend as described in the root README. `pnpm preview` proxies `/api` to it, just like `pnpm dev`.
2. `pnpm build && pnpm preview`, then open http://localhost:4173 in Chrome or Edge.
3. DevTools → **Application**:
   - **Manifest:** name, colours and icons, including maskable ones (tick "Show only the minimum safe area for
     maskable icons" to check the crop). The browser's install icon appears in the address bar.
   - **Service workers:** `sw.js` is "activated and running". Leave "Update on reload" **unticked**, otherwise the
     update prompt can't be seen.
   - **Cache storage:** only `workbox-precache-v2-…`, holding built files. There are no `/api` responses or audio.
4. **Offline:** DevTools → Network → throttling **Offline** (or the "Offline" box under Application → Service
   workers).
   - Reload: the app still opens, and the offline pill shows.
   - Parent pages say they'll update when back online. Switch back online and they load by themselves.
   - Child: on a game's intro the Start button is replaced by the "We need the internet" message. Start a game
     online, go offline mid-round to see "Reconnecting…", then go back online and carry on.
5. **Update flow:** keep the tab open, change some visible text, run `pnpm build` again and restart `pnpm preview`.
   In the open tab, DevTools → Application → Service workers → **Update** (or wait for the hourly check). "A new version
   is ready" appears. During a game it stays hidden until the game ends.
6. **Sign-out:** sign out and check Cache storage again: still only the build precache.
7. **Start over:** Application → Storage → **Clear site data** removes the worker and its cache.

`pnpm preview` runs on port 4173 and `pnpm dev` on 5173. These are different origins, so a worker from preview never
affects development.

**On a phone:** service workers need HTTPS (or `localhost`), so `http://<your-LAN-IP>:4173` won't register one.
Test installation on a deployed HTTPS build, or put an HTTPS tunnel in front of `pnpm preview`. On iPhone, open the
site in Safari to see the install instructions. They are not shown in Chrome on iOS, nor once the app is installed.
