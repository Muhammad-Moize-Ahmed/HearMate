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
