import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawVersion } from '../fixtures';
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
    const { result } = renderHookWithProviders(() =>
      useVersions('room-1', 'doc-1', undefined, true),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions`);
    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'version-1', wordsAdded: 2 }),
    ]);
  });

  it("reads a Note's history from the Note's own route", async () => {
    fetchMock.mockResolvedValue([]);
    const { result } = renderHookWithProviders(() =>
      useVersions('room-1', 'doc-1', 'note-1', true),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/notes/note-1/versions`);
  });

  it('asks for nothing while the history is closed', () => {
    renderHookWithProviders(() => useVersions('room-1', 'doc-1', undefined, false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useVersion', () => {
  it('reads one version in full', async () => {
    fetchMock.mockResolvedValue({ ...rawVersion(), description: 'Un cancello.' });
    const { result } = renderHookWithProviders(() =>
      useVersion('room-1', 'doc-1', 'note-1', 'version-1'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/notes/note-1/versions/version-1`);
    expect(result.current.data?.description).toBe('Un cancello.');
  });

  it('stays idle until a version is chosen', () => {
    renderHookWithProviders(() => useVersion('room-1', 'doc-1', undefined, null));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useRestoreVersion', () => {
  it("posts the restore and reloads the Room's Documents, histories included", async () => {
    fetchMock.mockResolvedValue({ ...rawVersion(), description: 'Un cancello.' });
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

  it("restores a Note's version through the Note's route", async () => {
    fetchMock.mockResolvedValue({ ...rawVersion(), description: '' });
    const { result } = renderHookWithProviders(() =>
      useRestoreVersion('room-1', 'doc-1', 'note-1'),
    );

    await result.current.mutateAsync('version-2');

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/notes/note-1/versions/version-2/restore`, {
      method: 'POST',
    });
  });
});
