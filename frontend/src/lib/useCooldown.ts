import { useCallback, useEffect, useState } from 'react';

/** A countdown in seconds, e.g. to stop "send the code again" being pressed over and over. */
export function useCooldown(): [remaining: number, start: (seconds: number) => void] {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const start = useCallback((seconds: number) => setRemaining(seconds), []);
  return [remaining, start];
}
