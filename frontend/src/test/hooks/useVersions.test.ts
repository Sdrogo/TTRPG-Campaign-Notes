import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawVersion, rawVersionDetail } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useRestoreVersion, useVersion, useVersions } from '../../hooks/useVersions';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const DOC = '/rooms/room-1/documents/doc-1';

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useVersions', () => {
  it("reads a Document's history", async () => {
    fetchMock.mockResolvedValue([rawVersion({ words_added: 2, words_removed: 0 })]);
    const { result } = renderHookWithProviders(() => useVersions('room-1', 'doc-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions`);
    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'version-1', wordsAdded: 2 }),
    ]);
  });

  it('asks for nothing while the history is closed', () => {
    renderHookWithProviders(() => useVersions('room-1', 'doc-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useVersion', () => {
  it('reads one revision in full, its Notes included', async () => {
    fetchMock.mockResolvedValue(
      rawVersionDetail({ notes: [{ id: 'note-1', title: 'Chiave', description: 'Sotto.' }] }),
    );
    const { result } = renderHookWithProviders(() => useVersion('room-1', 'doc-1', 'version-1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions/version-1`);
    expect(result.current.data?.description).toBe('Un cancello.');
    expect(result.current.data?.notes).toEqual([
      { id: 'note-1', title: 'Chiave', description: 'Sotto.' },
    ]);
  });

  it('stays idle until a revision is chosen', () => {
    renderHookWithProviders(() => useVersion('room-1', 'doc-1', null));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useRestoreVersion', () => {
  it("posts the restore and reloads the Room's Documents, the history included", async () => {
    fetchMock.mockResolvedValue(rawVersionDetail());
    const { result, queryClient } = renderHookWithProviders(() =>
      useRestoreVersion('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('version-1');

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions/version-1/restore`, {
      method: 'POST',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'documents'] });
  });
});
