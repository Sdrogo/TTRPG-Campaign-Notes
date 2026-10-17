import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawGeoMapDetail } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useChangeBackground, useGeoMap, useResizePlane, useSaveGeo } from '../../hooks/useGeoMap';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const GEO_KEY = ['rooms', 'room-1', 'maps', 'map-1', 'geo'];
const LIST_KEY = ['rooms', 'room-1', 'maps'];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(rawGeoMapDetail());
});

describe('the geographic map hooks (spec 38)', () => {
  it('reads the map with its content', async () => {
    const { result } = renderHookWithProviders(() => useGeoMap('room-1', 'map-1', true));
    await waitFor(() => expect(result.current.data?.areas).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/geo');
  });

  it('saves the whole map, keeps the answer and refreshes the list', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useSaveGeo('room-1', 'map-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await result.current.mutateAsync({ areas: [], pins: [], links: [] });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/geo', {
      method: 'PUT',
      json: { areas: [], pins: [], links: [] },
    });
    expect(queryClient.getQueryData(GEO_KEY)).toMatchObject({ name: 'Shibuya di notte' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY, exact: true });
  });

  it("changes the plane's size and reloads the maps", async () => {
    const { result, queryClient } = renderHookWithProviders(() => useResizePlane('room-1', 'map-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await result.current.mutateAsync({ width: 3000, height: 1500 });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1', {
      method: 'PATCH',
      json: { plane_width: 3000, plane_height: 1500 },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
  });

  it('uploads, imports and removes the background', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useChangeBackground('room-1', 'map-1'));
    const file = new File(['png'], 'shibuya.png', { type: 'image/png' });
    await result.current.mutateAsync({ file });
    const [path, init] = fetchMock.mock.calls[0] as [string, { method: string; formData: FormData }];
    expect(path).toBe('/rooms/room-1/maps/map-1/background');
    expect(init.method).toBe('POST');
    expect(init.formData.get('file')).toBe(file);

    await result.current.mutateAsync({ url: 'https://example.com/map.png' });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/background/from-url', {
      method: 'POST',
      json: { url: 'https://example.com/map.png' },
    });

    await result.current.mutateAsync(null);
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/background', { method: 'DELETE' });
    expect(queryClient.getQueryData(GEO_KEY)).toMatchObject({ kind: 'geographic' });
  });
});
