import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawDocumentFile } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useDeleteDocumentFile, useUploadDocumentFile } from '../../hooks/useDocumentFiles';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const BASE = '/rooms/room-1/documents/doc-1/files';
const DETAIL_KEY = ['rooms', 'room-1', 'documents', 'doc-1'];

beforeEach(() => {
  fetchMock.mockReset();
});

// Files arrive embedded in the Document (spec 16), so every change reloads
// that one Document.
describe('useUploadDocumentFile', () => {
  it('sends the file as multipart and reloads the Document', async () => {
    fetchMock.mockResolvedValue(rawDocumentFile());
    const { result, queryClient } = renderHookWithProviders(() =>
      useUploadDocumentFile('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const file = new File(['%PDF-1.7'], 'scheda.pdf', { type: 'application/pdf' });

    const uploaded = await result.current.mutateAsync(file);

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(BASE);
    expect(init?.method).toBe('POST');
    expect(init?.formData?.get('file')).toBe(file);
    expect(uploaded.name).toBe('Scheda di Aria.pdf');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });
});

describe('useDeleteDocumentFile', () => {
  it('deletes the file and reloads the Document', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() =>
      useDeleteDocumentFile('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('file-1');

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/file-1`, { method: 'DELETE' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });
});
