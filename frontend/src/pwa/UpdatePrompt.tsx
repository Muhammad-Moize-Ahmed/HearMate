import { Button } from '../components/ui/Button';
import { useGameActive } from '../lib/gameActivity';
import { updates, useUpdateReady, type Updates } from './updates';

/** "A new version is ready — Refresh". Hidden while a game is in progress; it waits until after. */
export function UpdatePrompt({ store = updates }: { store?: Updates }) {
  const ready = useUpdateReady(store);
  const inGame = useGameActive();
  if (!ready || inGame) return null;

  return (
    <div
      role="region"
      aria-label="App update"
      className="pointer-events-auto flex w-full max-w-md flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 pl-4 shadow-lg ring-2 ring-brand-200"
    >
      <p className="font-bold">A new version is ready</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={store.dismiss}>
          Later
        </Button>
        <Button onClick={store.apply}>Refresh</Button>
      </div>
    </div>
  );
}
