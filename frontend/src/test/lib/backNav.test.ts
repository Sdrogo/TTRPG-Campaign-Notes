import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { backCandidates, backDestination, backStateFor, backTarget, useBackState } from '../../lib/backNav';

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

  it('reads the nearest place of a trail', () => {
    expect(backDestination({ from: '/rooms/r1/maps/m1', backStack: ['/rooms/r1/documents/d1'] }, '/rooms')).toBe(
      '/rooms/r1/maps/m1',
    );
  });
});

describe('backCandidates', () => {
  it('lists the trail nearest first, each with the rest of the trail, then the parent', () => {
    expect(
      backCandidates(
        { from: '/rooms/r1/maps/m1', backStack: ['/rooms/r1/documents', '/rooms/r1/documents/d1', 'https://evil.example'] },
        '/rooms/r1/maps',
      ),
    ).toEqual([
      { path: '/rooms/r1/maps/m1', state: { from: '/rooms/r1/documents/d1', backStack: ['/rooms/r1/documents'] } },
      { path: '/rooms/r1/documents/d1', state: { from: '/rooms/r1/documents' } },
      { path: '/rooms/r1/documents', state: undefined },
      { path: '/rooms/r1/maps' },
    ]);
  });

  it('is only the parent without a trail', () => {
    expect(backCandidates(null, '/rooms')).toEqual([{ path: '/rooms' }]);
  });
});

describe('backStateFor', () => {
  it('keeps the last places only', () => {
    const trail = Array.from({ length: 30 }, (_, index) => `/p${index}`);
    const state = backStateFor(trail)!;
    expect(state.from).toBe('/p29');
    expect(state.backStack).toHaveLength(19);
    expect(state.backStack![0]).toBe('/p10');
  });
});

describe('backTarget', () => {
  it('names the Document or map a path shows', () => {
    expect(backTarget('/rooms/r1/documents/d1?side=d2')).toEqual({ kind: 'document', roomId: 'r1', documentId: 'd1' });
    expect(backTarget('/rooms/r1/documents/d1/mention-map')).toEqual({
      kind: 'document',
      roomId: 'r1',
      documentId: 'd1',
    });
    expect(backTarget('/rooms/r1/maps/m1')).toEqual({ kind: 'map', roomId: 'r1', mapId: 'm1' });
  });

  it('is null for list pages', () => {
    expect(backTarget('/rooms/r1/documents')).toBeNull();
    expect(backTarget('/rooms/r1/maps')).toBeNull();
    expect(backTarget('/rooms/r1/setup')).toBeNull();
    expect(backTarget('/rooms')).toBeNull();
  });
});

describe('useBackState', () => {
  function stateFrom(here: string, state: unknown) {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [{ pathname: here, state }] }, children);
    return renderHook(() => useBackState(), { wrapper }).result.current;
  }

  it('puts the current page on top of its own trail', () => {
    expect(stateFrom('/rooms/r1/maps/m1', { from: '/rooms/r1/documents' })).toEqual({
      from: '/rooms/r1/maps/m1',
      backStack: ['/rooms/r1/documents'],
    });
  });

  it('cuts the trail when coming back to a page already on it', () => {
    expect(
      stateFrom('/rooms/r1/documents/d1', {
        from: '/rooms/r1/maps/m1',
        backStack: ['/rooms/r1/documents', '/rooms/r1/documents/d1'],
      }),
    ).toEqual({ from: '/rooms/r1/documents/d1', backStack: ['/rooms/r1/documents'] });
  });
});
