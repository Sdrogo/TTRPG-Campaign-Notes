import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawNote } from '../test/fixtures';
import { renderHookWithProviders } from '../test/utils';
import { useCreateNote, useDeleteNote, useReorderNotes, useUpdateNote } from './useNotes';
import type { QueryClient } from '@tanstack/react-query';
import type { NoteFormValues } from '../types/note';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const BASE = '/rooms/room-1/documents/doc-1/notes';
const DETAIL_KEY = ['rooms', 'room-1', 'documents', 'doc-1'];

const form: NoteFormValues = {
  title: 'Porta segreta',
  description: 'Dietro la libreria.',
  visibility: 'selective',
  selectiveUserIds: ['user-2'],
};

beforeEach(() => {
  fetchMock.mockReset();
});

// Notes arrive embedded in the Document, so every change reloads that one
// Document - and only it: the list carries no Notes.
function spyOnInvalidate(queryClient: QueryClient) {
  return vi.spyOn(queryClient, 'invalidateQueries');
}

describe('useCreateNote', () => {
  it('posts the form as the wire body and reloads the Document', async () => {
    fetchMock.mockResolvedValue(rawNote());
    const { result, queryClient } = renderHookWithProviders(() => useCreateNote('room-1', 'doc-1'));
    const invalidate = spyOnInvalidate(queryClient);

    const created = await result.current.mutateAsync(form);

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: {
        title: 'Porta segreta',
        description: 'Dietro la libreria.',
        visibility: 'selective',
        selective_user_ids: ['user-2'],
      },
    });
    expect(created?.title).toBe('Porta segreta');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });

  it('succeeds and reloads the Document when the created Note is hidden', async () => {
    fetchMock.mockResolvedValue(null);
    const { result, queryClient } = renderHookWithProviders(() => useCreateNote('room-1', 'doc-1'));
    const invalidate = spyOnInvalidate(queryClient);

    await expect(result.current.mutateAsync(form)).resolves.toBeNull();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
  });
});

describe('useUpdateNote', () => {
  it('patches the Note and reloads the Document', async () => {
    fetchMock.mockResolvedValue(rawNote({ title: 'Nuovo' }));
    const { result, queryClient } = renderHookWithProviders(() => useUpdateNote('room-1', 'doc-1'));
    const invalidate = spyOnInvalidate(queryClient);

    await result.current.mutateAsync({
      noteId: 'note-1',
      values: { ...form, visibility: 'room', title: 'Nuovo' },
    });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/note-1`, {
      method: 'PATCH',
      json: {
        title: 'Nuovo',
        description: 'Dietro la libreria.',
        visibility: 'room',
        selective_user_ids: [],
      },
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });

  it('succeeds and reloads the Document when the updated Note is hidden', async () => {
    fetchMock.mockResolvedValue(null);
    const { result, queryClient } = renderHookWithProviders(() => useUpdateNote('room-1', 'doc-1'));
    const invalidate = spyOnInvalidate(queryClient);

    await expect(result.current.mutateAsync({ noteId: 'note-1', values: form })).resolves.toBeNull();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
  });
});

describe('useDeleteNote', () => {
  it('deletes the Note and reloads the Document', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteNote('room-1', 'doc-1'));
    const invalidate = spyOnInvalidate(queryClient);

    await result.current.mutateAsync('note-1');

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/note-1`, { method: 'DELETE' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });
});

describe('useReorderNotes', () => {
  it('puts the ids in the new order and returns the Notes', async () => {
    fetchMock.mockResolvedValue([rawNote({ id: 'note-2' }), rawNote()]);
    const { result } = renderHookWithProviders(() => useReorderNotes('room-1', 'doc-1'));

    const notes = await result.current.mutateAsync(['note-2', 'note-1']);

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/order`, {
      method: 'PUT',
      json: { note_ids: ['note-2', 'note-1'] },
    });
    expect(notes.map((note) => note.id)).toEqual(['note-2', 'note-1']);
  });

  it.each(['succeeds', 'fails'])(
    'stays pending until the Document reloads when reordering %s',
    async (outcome) => {
      if (outcome === 'succeeds') {
        fetchMock.mockResolvedValue([rawNote()]);
      } else {
        fetchMock.mockRejectedValue(new Error('422'));
      }
      const { result, queryClient } = renderHookWithProviders(() =>
        useReorderNotes('room-1', 'doc-1'),
      );
      let finishReload!: () => void;
      const reload = new Promise<void>((resolve) => {
        finishReload = resolve;
      });
      const invalidate = spyOnInvalidate(queryClient).mockReturnValue(reload);
      const onFinished = vi.fn();

      const mutation = result.current.mutateAsync(['note-1']).then(onFinished, onFinished);

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
      expect(result.current.isPending).toBe(true);
      expect(onFinished).not.toHaveBeenCalled();

      finishReload();
      await mutation;

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.isError).toBe(outcome === 'fails');
      expect(onFinished).toHaveBeenCalledOnce();
    },
  );

  // A 422 means the Notes changed under us: reload so the list is true again.
  it('reloads the Document even when the order is rejected', async () => {
    fetchMock.mockRejectedValue(new Error('422'));
    const { result, queryClient } = renderHookWithProviders(() =>
      useReorderNotes('room-1', 'doc-1'),
    );
    const invalidate = spyOnInvalidate(queryClient);

    await expect(result.current.mutateAsync(['note-1'])).rejects.toThrow('422');

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY }));
  });
});
