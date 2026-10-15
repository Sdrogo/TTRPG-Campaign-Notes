import { describe, expect, it } from 'vitest';
import { backDestination } from '../../lib/backNav';

describe('backDestination', () => {
  it('returns the page it was opened from, when given', () => {
    expect(backDestination({ from: '/rooms/r1/documents/d1?side=d2' }, '/rooms/r1/maps')).toBe(
      '/rooms/r1/documents/d1?side=d2',
    );
  });

  it('falls back to the parent without a usable origin', () => {
    expect(backDestination(null, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
    expect(backDestination({}, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
    expect(backDestination({ from: 42 }, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
    expect(backDestination({ from: 'https://evil.example' }, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
    expect(backDestination({ from: '/\\evil.example' }, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
    expect(backDestination({ from: '//evil.example' }, '/rooms/r1/maps')).toBe('/rooms/r1/maps');
  });
});
