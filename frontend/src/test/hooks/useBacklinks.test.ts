import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { renderHookWithProviders } from '../utils';
import { useBacklinks } from '../../hooks/useBacklinks';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useBacklinks', () => {
  it("loads a Document's backlinks and maps them from the wire", async () => {
    fetchMock.mockResolvedValue([
      {
        document_id: 'doc-2',
        document_name: 'La Locanda',
        mentions: [
          {
            kind: 'comment',
            note_id: null,
            note_title: null,
            comment_id: 'comment-1',
            comment_author_id: 'user-2',
            excerpt: 'Vai al #Il Cancello',
          },
        ],
      },
    ]);

    const { result } = renderHookWithProviders(() =>
      useBacklinks('room-1', { kind: 'document', id: 'doc-1' }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/backlinks');
    expect(result.current.data).toEqual([
      {
        documentId: 'doc-2',
        documentName: 'La Locanda',
        mentions: [
          {
            kind: 'comment',
            noteId: null,
            noteTitle: null,
            commentId: 'comment-1',
            commentAuthorId: 'user-2',
            excerpt: 'Vai al #Il Cancello',
          },
        ],
      },
    ]);
  });

  it("loads a Tag's backlinks from the Tag's route", async () => {
    fetchMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() =>
      useBacklinks('room-1', { kind: 'tag', id: 'tag-1' }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/tag-1/backlinks');
  });

  // Saving any Document refreshes the Room's Documents, and this with them.
  it("is refreshed with the Room's Documents", async () => {
    fetchMock.mockResolvedValue([]);
    const { result, queryClient } = renderHookWithProviders(() =>
      useBacklinks('room-1', { kind: 'document', id: 'doc-1' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await queryClient.invalidateQueries({ queryKey: ['rooms', 'room-1', 'documents'] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
