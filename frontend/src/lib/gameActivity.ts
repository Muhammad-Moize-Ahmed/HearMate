/**
 * Whether a child is in the middle of a game (a session started and not finished). Anything that
 * would interrupt (an update prompt, a reload, the general offline banner) checks this first.
 */
import { useSyncExternalStore } from 'react';

let active = false;
const listeners = new Set<() => void>();

export function setGameActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}

export function isGameActive(): boolean {
  return active;
}

export function subscribeGameActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGameActive(): boolean {
  return useSyncExternalStore(subscribeGameActivity, isGameActive, () => false);
}
