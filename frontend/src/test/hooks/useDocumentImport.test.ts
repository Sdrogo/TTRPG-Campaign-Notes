import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useImportJob, usePreviewImport, useStartImport } from '../../hooks/useDocumentImport';
import { rawImportJob, rawImportPreview } from '../fixtures';
import { createTestQueryClient, renderHookWithProviders } from '../utils';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const files = [new File(['{}'], 'stanza.json')];

type Upload = { method: string; formData: FormData };

beforeEach(() => {
  fetchMock.mockReset();
});

describe('usePreviewImport', () => {
  it('uploads the files for a preview and maps the answer (spec 27 Decision 9)', async () => {
    fetchMock.mockResolvedValue(rawImportPreview());
    const { result } = renderHookWithProviders(() => usePreviewImport('room-1'));

    let preview;
    await act(async () => {
      preview = await result.current.mutateAsync(files);
    });

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, Upload];
    expect(path).toBe('/rooms/room-1/imports/preview');
    expect(init.method).toBe('POST');
    expect(init.formData.getAll('files')).toHaveLength(1);
    expect(preview).toMatchObject({ documents: [{ key: '0:0', name: 'Il Cancello' }] });
  });
});

describe('useStartImport', () => {
  it('uploads the files again with the choices and gets the queued job', async () => {
    fetchMock.mockResolvedValue(rawImportJob());
    const { result } = renderHookWithProviders(() => useStartImport('room-1'));

    let job;
    await act(async () => {
      job = await result.current.mutateAsync({ files, selected: ['0:0'], replace: [] });
    });

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, Upload];
    expect(path).toBe('/rooms/room-1/imports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.formData.get('choices') as string)).toEqual({
      selected: ['0:0'],
      replace: [],
    });
    expect(job).toMatchObject({ id: 'import-1', status: 'queued' });
  });
});

describe('useImportJob', () => {
  it('reads nothing without a job', () => {
    renderHookWithProviders(() => useImportJob('room-1', null));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads its own job, never as the member being previewed', async () => {
    fetchMock.mockResolvedValue(rawImportJob({ status: 'running' }));

    const { result } = renderHookWithProviders(() => useImportJob('room-1', 'import-1'));

    await waitFor(() => expect(result.current.data?.status).toBe('running'));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/imports/import-1', {
      ignoreViewAs: true,
    });
  });

  it('reads the Room again when the job is done (spec 27)', async () => {
    fetchMock.mockResolvedValue(
      rawImportJob({ status: 'done', result: { created: [], replaced: [], skipped: [] } }),
    );
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderHookWithProviders(() => useImportJob('room-1', 'import-1'), { queryClient });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'documents'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'tags'] });
  });

  it('does not touch the Room while the job is still going', async () => {
    fetchMock.mockResolvedValue(rawImportJob());
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useImportJob('room-1', 'import-1'), {
      queryClient,
    });

    await waitFor(() => expect(result.current.data?.status).toBe('queued'));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
