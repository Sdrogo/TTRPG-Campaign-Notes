import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawDocumentRead, rawHistoryEntry, rawMyReveal } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useDocumentVisit } from '../../hooks/useDocuments';
import {
  useMyReveals,
  useRevealComment,
  useRevealDocument,
  useRevealNote,
  useRevealedInVisit,
  useVisibilityHistory,
} from '../../hooks/useReveals';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useMyReveals', () => {
  it('maps what was revealed to the user', async () => {
    fetchMock.mockResolvedValue([
      rawMyReveal({ kind: 'note', note_id: 'note-1', note_title: 'Porta segreta' }),
    ]);

    const { result } = renderHookWithProviders(() => useMyReveals(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/reveals/mine');
    expect(result.current.data).toEqual([
      {
        id: 'reveal-1',
        roomId: 'room-1',
        kind: 'note',
        documentId: 'doc-1',
        noteId: 'note-1',
        commentId: null,
        revealedAt: '2026-10-03T12:00:00Z',
        roomName: 'La Cripta',
        documentName: 'Il Cancello',
        noteTitle: 'Porta segreta',
      },
    ]);
  });
});

describe('useRevealedInVisit', () => {
  // Spec 22 Decision 3: opening the Document opens what was revealed in it.
  it('reads what the visit opened, and refreshes the badge', async () => {
    fetchMock.mockResolvedValue(
      rawDocumentRead({ revealed: { document: true, note_ids: ['note-1'], comment_ids: ['c-1'] } }),
    );

    const { result, queryClient } = renderHookWithProviders(() => {
      useDocumentVisit('room-1', 'doc-1', true);
      return useRevealedInVisit('room-1', 'doc-1');
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() =>
      expect(result.current).toEqual({ document: true, noteIds: ['note-1'], commentIds: ['c-1'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reveals', 'mine'] });
  });

  it('is undefined before the visit is recorded, and never fetches', () => {
    const { result } = renderHookWithProviders(() => useRevealedInVisit('room-1', 'doc-1'));

    expect(result.current).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the Reveal mutations', () => {
  it('reveals a Document with the Notes picked', async () => {
    fetchMock.mockResolvedValue({});
    const { result, queryClient } = renderHookWithProviders(() =>
      useRevealDocument('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({
      audience: { toRoom: true, userIds: [] },
      noteIds: ['note-1'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/reveal', {
      method: 'POST',
      json: { to_room: true, user_ids: [], note_ids: ['note-1'] },
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'documents'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'room-1', 'audit-log'] });
    });
  });

  it('reveals a Note', async () => {
    fetchMock.mockResolvedValue({});
    const { result } = renderHookWithProviders(() => useRevealNote('room-1', 'doc-1'));

    await result.current.mutateAsync({
      noteId: 'note-1',
      audience: { toRoom: false, userIds: ['user-2'] },
    });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/notes/note-1/reveal', {
      method: 'POST',
      json: { to_room: false, user_ids: ['user-2'] },
    });
  });

  it('reveals a Comment', async () => {
    fetchMock.mockResolvedValue({});
    const { result } = renderHookWithProviders(() => useRevealComment('room-1', 'doc-1'));

    await result.current.mutateAsync({ commentId: 'c-1', audience: { toRoom: true, userIds: [] } });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments/c-1/reveal', {
      method: 'POST',
      json: { to_room: true, user_ids: [] },
    });
  });
});

describe('useVisibilityHistory', () => {
  it('reads the history a page at a time', async () => {
    fetchMock
      .mockResolvedValueOnce({ entries: [rawHistoryEntry()], next_before: 'entry-1' })
      .mockResolvedValueOnce({
        entries: [rawHistoryEntry({ id: 'entry-2', state: 'hidden', document_id: null })],
        next_before: null,
      });

    const { result } = renderHookWithProviders(() => useVisibilityHistory('room-1', null, true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/audit-log');
    expect(result.current.data).toEqual([
      {
        id: 'entry-1',
        createdAt: '2026-10-03T12:00:00Z',
        actorId: 'user-1',
        kind: 'document',
        isReveal: true,
        state: 'visible',
        fromVisibility: 'master',
        toVisibility: 'room',
        documentId: 'doc-1',
        documentName: 'Il Cancello',
        noteId: null,
        noteTitle: null,
        commentId: null,
        selectiveUserIds: [],
        recipientIds: ['user-2'],
      },
    ]);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/audit-log?before=entry-1');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('filters by kind of content', async () => {
    fetchMock.mockResolvedValue({ entries: [], next_before: null });

    const { result } = renderHookWithProviders(() => useVisibilityHistory('room-1', 'note', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/audit-log?kind=note');
  });
});
