import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { formatAbsoluteTime, formatRelativeTime } from './time';

const now = new Date('2026-09-21T12:00:00Z');

describe('formatRelativeTime', () => {
  it('says "adesso" for the last minute', () => {
    expect(formatRelativeTime('2026-09-21T11:59:30Z', now)).toBe('adesso');
  });

  it('uses the largest fitting unit', () => {
    expect(formatRelativeTime('2026-09-21T11:55:00Z', now)).toBe('5 minuti fa');
    expect(formatRelativeTime('2026-09-21T09:00:00Z', now)).toBe('3 ore fa');
    expect(formatRelativeTime('2026-09-20T12:00:00Z', now)).toBe('ieri');
  });

  it('reaches the coarser units', () => {
    expect(formatRelativeTime('2026-09-14T12:00:00Z', now)).toBe('settimana scorsa');
    expect(formatRelativeTime('2026-06-21T12:00:00Z', now)).toBe('3 mesi fa');
    expect(formatRelativeTime('2024-09-21T12:00:00Z', now)).toBe('2 anni fa');
  });

  // Clock skew between the server and the browser can date a Comment a few
  // seconds into the future; it must still read sensibly, not crash.
  it('handles a timestamp in the future', () => {
    expect(formatRelativeTime('2026-09-21T12:00:20Z', now)).toBe('adesso');
    expect(formatRelativeTime('2026-09-21T14:00:00Z', now)).toBe('tra 2 ore');
  });

  it('defaults to the current time when no reference is given', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('adesso');
  });
});

describe('formatAbsoluteTime', () => {
  it('renders an Italian date and time', () => {
    const formatted = formatAbsoluteTime('2026-09-21T12:00:00Z');

    // Asserting the exact string would pin the test to one ICU version, so
    // check the parts that matter: Italian month name, day, year.
    expect(formatted).toContain('2026');
    expect(formatted).toContain('set');
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

// Spec 09: timestamps follow the UI language, not a fixed locale.
describe('in English', () => {
  it('formats relative and absolute times in English', async () => {
    await setLanguage('en');

    expect(formatRelativeTime('2026-09-21T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-09-21T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelativeTime('2026-09-20T12:00:00Z', now)).toBe('yesterday');
    expect(formatAbsoluteTime('2026-09-21T12:00:00Z')).toContain('Sep');
  });
});
