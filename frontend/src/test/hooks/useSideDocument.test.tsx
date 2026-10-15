import { act } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderHookWithProviders } from '../utils';
import { useSideDocument } from '../../hooks/useSideDocument';

describe('useSideDocument (spec 37)', () => {
  it('opens a Document beside the page in the address, replaces it and closes it', () => {
    const { result } = renderHookWithProviders(
      () => ({ side: useSideDocument(), location: useLocation() }),
      { route: '/rooms/room-1/maps/map-1?view=user-2' },
    );
    expect(result.current.side.sideId).toBeNull();

    act(() => result.current.side.open('doc-1'));
    expect(result.current.side.sideId).toBe('doc-1');
    expect(result.current.location.search).toBe('?view=user-2&side=doc-1');

    act(() => result.current.side.open('doc-2'));
    expect(result.current.side.sideId).toBe('doc-2');

    act(() => result.current.side.close());
    expect(result.current.side.sideId).toBeNull();
    expect(result.current.location.search).toBe('?view=user-2');
  });
});
