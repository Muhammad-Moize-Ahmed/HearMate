import { NetworkStatus } from './NetworkStatus';
import { UpdatePrompt } from './UpdatePrompt';

/** Notices for the whole app, stacked at the bottom of the screen above the home indicator. */
export function AppNotices() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] print:hidden">
      <NetworkStatus />
      <UpdatePrompt />
    </div>
  );
}
