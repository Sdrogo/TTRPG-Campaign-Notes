const relative = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('it', { dateStyle: 'medium', timeStyle: 'short' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

// "3 minuti fa", "ieri", ... - social-media style timestamps.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((Date.parse(iso) - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return 'adesso';
}

export function formatAbsoluteTime(iso: string): string {
  return absolute.format(new Date(iso));
}
