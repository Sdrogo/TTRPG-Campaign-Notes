import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawGeoMapDetail } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  useChangeBackground,
  useExportMap,
  useGeoMap,
  useImportMap,
  usePreviewMapImport,
  useResizePlane,
  useSaveGeo,
} from '../../hooks/useGeoMap';
import { saveBlob } from '../../lib/roomExport';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/roomExport', async (original) => ({
  ...(await original<typeof import('../../lib/roomExport')>()),
  saveBlob: vi.fn(),
}));

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
    await result.current.mutateAsync({ value: { areas: [], pins: [], links: [] }, baseRevision: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/geo', {
      method: 'PUT',
      json: { base_revision: 3, areas: [], pins: [], links: [] },
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

  it('previews an import without writing anything (spec 38_3)', async () => {
    fetchMock.mockResolvedValue({
      name: 'Shibuya',
      description: '',
      plane_width: 2000,
      plane_height: 1400,
      areas: 6,
      pins: 14,
      links: 4,
      matched: 8,
      not_found: ['Elysium'],
      ambiguous: [],
      repeated: [],
    });
    const { result } = renderHookWithProviders(() => usePreviewMapImport('room-1'));
    const report = await result.current.mutateAsync({ schema_version: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/import/preview', {
      method: 'POST',
      json: { map: { schema_version: 1 } },
    });
    expect(report).toMatchObject({ planeWidth: 2000, notFound: ['Elysium'], matched: 8 });
  });

  it('imports a file as a new map and refreshes the list', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useImportMap('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const created = await result.current.mutateAsync({
      map: { schema_version: 1 },
      values: { name: 'Shibuya', description: '', visibility: 'selective', selectiveUserIds: ['user-2'] },
    });
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/import', {
      method: 'POST',
      json: {
        map: { schema_version: 1 },
        name: 'Shibuya',
        description: '',
        visibility: 'selective',
        selective_user_ids: ['user-2'],
      },
    });
    expect(created.kind).toBe('geographic');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY, exact: true });
  });

  it('downloads the map as a JSON file', async () => {
    fetchMock.mockResolvedValue({ schema_version: 1, name: 'Shibuya' });
    const { result } = renderHookWithProviders(() => useExportMap('room-1', 'map-1', 'Shibuya di notte'));
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/export');
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^shibuya-di-notte-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await blob.text()).toBe('{\n  "schema_version": 1,\n  "name": "Shibuya"\n}\n');
  });
});
