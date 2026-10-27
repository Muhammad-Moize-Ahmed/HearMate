/**
 * Cache Storage on sign-out. The service worker's precache holds only the build (HTML, JS, CSS,
 * icons) and nothing about any user, so it stays and the app still opens offline. Every other cache
 * the page can see is deleted. There shouldn't be any, as nothing is cached at run time, but this
 * keeps it that way if one ever appears (a future runtime cache, or one left by an older version).
 */
const PRECACHE_PREFIX = 'workbox-precache';

export async function clearUserCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => !name.startsWith(PRECACHE_PREFIX)).map((name) => caches.delete(name)),
  );
}
