/**
 * The period a progress page or report covers. It lives in the URL (?range=month, or
 * ?range=custom&from=…&to=…) so a report can be reloaded, bookmarked or printed as it is.
 */
import { addDays, daysInclusive } from '../../lib/dates';

export type Preset = 'week' | 'month' | 'quarter';

export const PRESETS: { value: Preset; label: string; days: number }[] = [
  { value: 'week', label: 'Week', days: 7 },
  { value: 'month', label: 'Month', days: 30 },
  { value: 'quarter', label: '3 months', days: 90 },
];

/** The backend accepts periods of 7 to 365 days. */
export const MIN_DAYS = 7;
export const MAX_DAYS = 365;

export type Range =
  { kind: Preset; days: number } | { kind: 'custom'; days: number; from: string; to: string };

/** What the progress endpoints take: a preset ends on the child's today (the server knows it). */
export function rangeQuery(range: Range): { days: number; end?: string } {
  return range.kind === 'custom' ? { days: range.days, end: range.to } : { days: range.days };
}

/** Why a custom range can't be used, or null when it can. Dates are "YYYY-MM-DD". */
export function customRangeError(from: string, to: string, today: string): string | null {
  if (!from || !to) return 'Choose a start and an end date.';
  if (to > today) return "The end date can't be in the future.";
  if (from > to) return 'The start date must be before the end date.';
  const days = daysInclusive(from, to);
  if (days < MIN_DAYS) return `Choose at least ${MIN_DAYS} days.`;
  if (days > MAX_DAYS) return 'Choose a year or less.';
  return null;
}

/** The range in the URL; anything missing or invalid falls back to `fallback`. */
export function readRange(params: URLSearchParams, today: string, fallback: Preset): Range {
  const kind = params.get('range');
  if (kind === 'custom') {
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (customRangeError(from, to, today) === null) {
      return { kind, from, to, days: daysInclusive(from, to) };
    }
  }
  const preset = PRESETS.find((p) => p.value === kind) ?? PRESETS.find((p) => p.value === fallback);
  return { kind: preset!.value, days: preset!.days };
}

export function rangeParams(range: Range): Record<string, string> {
  return range.kind === 'custom'
    ? { range: 'custom', from: range.from, to: range.to }
    : { range: range.kind };
}

/** A custom form starts from the period on screen: the last `days` up to today. */
export function defaultCustom(range: Range, today: string): { from: string; to: string } {
  return range.kind === 'custom'
    ? { from: range.from, to: range.to }
    : { from: addDays(today, 1 - range.days), to: today };
}
