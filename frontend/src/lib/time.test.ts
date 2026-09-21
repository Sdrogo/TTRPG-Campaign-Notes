import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

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
});
