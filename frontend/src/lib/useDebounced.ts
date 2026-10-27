import { useEffect, useState } from 'react';

/** `value`, but only once it has stopped changing for `ms` (e.g. a search box while typing). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
