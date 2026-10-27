import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { API_PATH, BACKGROUND_COLOR, pwaOptions, THEME_COLOR } from './options';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const bytes = read(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const workbox = pwaOptions.workbox!;

describe('Service worker: no API responses or audio are ever cached', () => {
  it('has no runtime caching at all, so only precached build files are served by the worker', () => {
    expect(workbox.runtimeCaching ?? []).toEqual([]);
  });

  it('never answers an API path with the app shell', () => {
    for (const path of [
      '/api',
      '/api/',
      '/api/auth/refresh',
      '/api/children/1/levels',
      '/api/sessions/1/rounds/0/stimulus',
    ]) {
      expect(workbox.navigateFallbackDenylist?.some((re) => re.test(path))).toBe(true);
    }
    // App pages still open offline.
    for (const path of ['/', '/parent', '/play/games/sound-detective', '/apiary']) {
      expect(API_PATH.test(path)).toBe(false);
    }
  });

  it('precaches the app shell and lazy chunks, but no audio', () => {
    /** The extensions in patterns like `**\/*.{js,css}`. */
    const extensions = (patterns: string[] = []) =>
      patterns.flatMap((p) => p.match(/\{(.+)\}/)?.[1]?.split(',') ?? []);
    const audio = ['wav', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'webm', 'flac'];

    expect(extensions(workbox.globPatterns)).toEqual(expect.arrayContaining(['js', 'css', 'html']));
    expect(extensions(workbox.globPatterns).filter((ext) => audio.includes(ext))).toEqual([]);
    expect(extensions(workbox.globIgnores)).toEqual(expect.arrayContaining(audio));
    expect(workbox.navigateFallback).toBe('index.html');
  });

  it('waits for "Refresh" before a new version takes over, and is off in development', () => {
    expect(pwaOptions.registerType).toBe('prompt');
    expect(workbox.skipWaiting).toBe(false);
    expect(pwaOptions.devOptions?.enabled).toBe(false);
    expect(pwaOptions.injectRegister).toBe(false);
  });
});

describe('Web app manifest', () => {
  const manifest = pwaOptions.manifest as Exclude<typeof pwaOptions.manifest, false | undefined>;

  it('installs as HearMate, standalone, from the root', () => {
    expect(manifest).toMatchObject({
      name: 'HearMate',
      short_name: 'HearMate',
      display: 'standalone',
      start_url: '/',
      scope: '/',
    });
  });

  it('uses the app colours', () => {
    const css = read('src/index.css').toString();
    expect(css).toContain(`--color-brand-600: ${THEME_COLOR};`);
    expect(css).toContain(`--color-brand-50: ${BACKGROUND_COLOR};`);
    expect(manifest.theme_color).toBe(THEME_COLOR);
    expect(manifest.background_color).toBe(BACKGROUND_COLOR);
    expect(read('index.html').toString()).toContain(
      `<meta name="theme-color" content="${THEME_COLOR}" />`,
    );
  });

  it('lists icons that exist, at their stated sizes, including maskable ones', () => {
    const icons = manifest.icons ?? [];
    for (const icon of icons) {
      const [w, h] = pngSize(join('public', icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    const sizes = (purpose: string) =>
      icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
    expect(sizes('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(sizes('maskable')).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('has the iPhone home-screen icon and meta tags', () => {
    const html = read('index.html').toString();
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="HearMate"');
    expect(html).toContain('viewport-fit=cover');
  });
});
