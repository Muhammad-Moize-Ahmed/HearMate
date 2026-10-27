/**
 * "Install app", for parents only. Android and desktop Chrome/Edge fire `beforeinstallprompt`,
 * which we keep and replay when the parent taps Install. iPhone and iPad Safari have no such event,
 * so parents there get the two steps to do it by hand.
 *
 * Never shown to children: not in the child's area, and not to a child's account anywhere.
 */
import { useSyncExternalStore } from 'react';

import type { PrincipalKind } from '../auth/session';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Keep the browser's install prompt for later. Called once from main.tsx, before React renders,
 * because the event can fire before any screen is up.
 */
export function listenForInstallPrompt(target: Window = window): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // no mini-infobar; we decide where it's offered
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

/** Show the browser's install dialog. It can be used once, so it's forgotten either way. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => deferred !== null,
    () => false,
  );
}

/** Already running as an installed app (Android/desktop, or iOS home-screen). */
export function isStandalone(): boolean {
  const media =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return media || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Safari on iPhone or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIosSafari(
  userAgent: string = navigator.userAgent,
  touchPoints: number = navigator.maxTouchPoints,
): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent);
  return ios && /Safari/.test(userAgent) && !otherBrowser;
}

export function isChildArea(pathname: string): boolean {
  return pathname === '/play' || pathname.startsWith('/play/');
}

export type InstallMode = 'native' | 'ios' | null;

/** Which install prompt (if any) to show. */
export function installPromptMode(input: {
  kind: PrincipalKind | null;
  pathname: string;
  standalone: boolean;
  dismissed: boolean;
  canPrompt: boolean;
  iosSafari: boolean;
}): InstallMode {
  if (input.kind !== 'parent' || isChildArea(input.pathname)) return null;
  if (input.standalone || input.dismissed) return null;
  if (input.canPrompt) return 'native';
  if (input.iosSafari) return 'ios';
  return null;
}

// "Not now" is remembered on this device for a while. Storage can be missing or blocked (private
// browsing), in which case the prompt just comes back next time.
const DISMISS_KEY = 'hearmate.install-dismissed-at';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60_000;

export function wasDismissed(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && now - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export function rememberDismissed(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(now));
  } catch {
    // Not stored: the prompt shows again on the next visit.
  }
}

/** Test helper: forget a kept install event. */
export function resetInstallPromptForTests(): void {
  deferred = null;
  listeners.clear();
}
