import i18n, { currentLanguage, type Language } from '../i18n';

// Building an Intl formatter is not free, so there is one per language,
// made the first time that language needs it.
const relativeFormatters = new Map<Language, Intl.RelativeTimeFormat>();
const absoluteFormatters = new Map<Language, Intl.DateTimeFormat>();

function relativeFormatter(language: Language): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    relativeFormatters.set(language, formatter);
  }
  return formatter;
}

function absoluteFormatter(language: Language): Intl.DateTimeFormat {
  let formatter = absoluteFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    absoluteFormatters.set(language, formatter);
  }
  return formatter;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 minutes ago", "yesterday", ... - social-media style timestamps, in the UI language. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((Date.parse(iso) - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relativeFormatter(currentLanguage()).format(Math.round(seconds / size), unit);
    }
  }
  return i18n.t('time.now');
}

/** The full date and time in the UI language - e.g. for the tooltip on a relative time. */
export function formatAbsoluteTime(iso: string): string {
  return absoluteFormatter(currentLanguage()).format(new Date(iso));
}
