/** Helpers for date-only values ("YYYY-MM-DD"), which carry no time zone. */

/** Today in the user's own time zone, as "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Whole years between a birth date and `today` (both "YYYY-MM-DD"). */
export function ageInYears(birthDate: string, today: string = todayISO()): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = today.split('-').map(Number);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** "12 Mar 2026". Read as UTC, so the calendar day never shifts with the viewer's time zone. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** The browser's IANA time zone, e.g. "Asia/Karachi". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** The date `days` after `iso` (negative goes back). */
export function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, counting both ends ("2026-10-01" to itself is 1). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS) + 1;
}

/** "12 Oct", for chart labels. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** A short span in the viewer's style, e.g. "3–9 Oct" or "28 Sep – 4 Oct". */
export function formatDateSpan(from: string, to: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));
}

/** The viewer's calendar day of a timestamp, e.g. "12 Mar 2026". */
export function formatDay(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp));
}
