import { useSearchParams } from 'react-router';

import { todayISO } from '../../lib/dates';
import { rangeParams, readRange, type Preset, type Range } from './range';

/** The page's period, read from and written to the URL. */
export function useRange(fallback: Preset) {
  const [params, setParams] = useSearchParams();
  const range = readRange(params, todayISO(), fallback);
  const setRange = (next: Range) => setParams(rangeParams(next), { replace: true });
  return [range, setRange] as const;
}
