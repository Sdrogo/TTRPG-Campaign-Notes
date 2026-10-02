import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { rawCharacter, rawComment, rawImage } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import { useComments, useDeleteComment, useSaveComment } from '../../hooks/useComments';
import type { CommentFormValues } from '../../types/comment';
import type { PendingImage } from '../../types/image';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const BASE = '/rooms/room-1/documents/doc-1/comments';
// Comment images are Document images, so the whole Document subtree goes.
const THREAD_KEY = ['rooms', 'room-1', 'documents'];

function values(overrides: Partial<CommentFormValues> = {}): CommentFormValues {
  return {
    body: 'Ricordate il sigillo.',
    visibility: 'room',
    selectiveUserIds: [],
    newImages: [],
    removedImageIds: [],
    ...overrides,
  };
}

function pendingFile(name: string): PendingImage {
  return {
    id: `pending-${name}`,
    source: new File(['bytes'], name, { type: 'image/png' }),
    previewUrl: 'blob:preview',
    label: name,
  };
}

function pendingUrl(url: string): PendingImage {
  return { id: `pending-${url}`, source: url, previewUrl: url, label: url };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useComments', () => {
  it('maps the wire shape onto the Comment model', async () => {
    fetchMock.mockResolvedValue([rawComment({ images: [rawImage()] })]);

    const { result } = renderHookWithProviders(() => useComments('room-1', 'doc-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(BASE);
    expect(result.current.data?.[0]).toEqual({
      id: 'comment-1',
      documentId: 'doc-1',
      authorId: 'user-1',
      body: 'Ricordate il sigillo.',
      visibility: 'room',
      selectiveUserIds: [],
      createdAt: '2026-09-21T12:00:00Z',
      updatedAt: '2026-09-21T12:00:00Z',
      deleted: false,
      images: [{ id: 'image-1', url: 'http://signed/image-1.webp', isFavorite: false }],
      canEdit: true,
      canDelete: true,
      asCharacter: null,
      parentId: null,
      parentHidden: false,
    });
  });

  // Spec 19: the list stays flat, each reply naming its parent.
  it('maps the Comment a reply answers, or that its parent is hidden', async () => {
    fetchMock.mockResolvedValue([
      rawComment({ id: 'reply', parent_id: 'comment-1' }),
      rawComment({ id: 'orphan', parent_hidden: true }),
    ]);

    const { result } = renderHookWithProviders(() => useComments('room-1', 'doc-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((c) => [c.parentId, c.parentHidden])).toEqual([
      ['comment-1', false],
      [null, true],
    ]);
  });

  it('maps the Character a Comment was written as', async () => {
    fetchMock.mockResolvedValue([rawComment({ as_character: rawCharacter() })]);

    const { result } = renderHookWithProviders(() => useComments('room-1', 'doc-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].asCharacter).toEqual({
      documentId: 'doc-2',
      name: 'Aria',
      imageUrl: 'http://signed/aria.webp',
    });
  });

  // The backend decides these per viewer; the UI must not re-derive them.
  it('carries the per-viewer permission flags through unchanged', async () => {
    fetchMock.mockResolvedValue([rawComment({ can_edit: false, can_delete: true })]);

    const { result } = renderHookWithProviders(() => useComments('room-1', 'doc-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].canEdit).toBe(false);
    expect(result.current.data?.[0].canDelete).toBe(true);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useComments('room-1', 'doc-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useSaveComment', () => {
  it('posts a new Comment when no id is given', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    const saved = await result.current.mutateAsync({ values: values() });

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: { body: 'Ricordate il sigillo.', visibility: 'room', selective_user_ids: [] },
    });
    expect(saved).toEqual({ commentId: 'comment-1', imageErrors: [] });
  });

  it('posts a reply with the Comment it answers', async () => {
    fetchMock.mockResolvedValue(rawComment({ id: 'reply' }));

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({ values: { ...values(), parentId: 'comment-1' } });

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: {
        body: 'Ricordate il sigillo.',
        visibility: 'room',
        selective_user_ids: [],
        parent_id: 'comment-1',
      },
    });
  });

  it('patches an existing Comment when an id is given', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({ commentId: 'comment-1', values: values() });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/comment-1`, {
      method: 'PATCH',
      json: { body: 'Ricordate il sigillo.', visibility: 'room', selective_user_ids: [] },
    });
  });

  it('sends the grant list at the Selective level', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({
      values: values({ visibility: 'selective', selectiveUserIds: ['user-2'] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: {
        body: 'Ricordate il sigillo.',
        visibility: 'selective',
        selective_user_ids: ['user-2'],
      },
    });
  });

  // Grants only mean anything at Selective. Leaving a stale list on a
  // Private Comment would be a visibility bug waiting for the next edit.
  it('drops the grant list at every other level', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({
      values: values({ visibility: 'private', selectiveUserIds: ['user-2'] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: { body: 'Ricordate il sigillo.', visibility: 'private', selective_user_ids: [] },
    });
  });

  it('removes images before uploading new ones', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({
      commentId: 'comment-1',
      values: values({ removedImageIds: ['image-9'], newImages: [pendingFile('a.png')] }),
    });

    const paths = fetchMock.mock.calls.map((call) => call[0]);
    expect(paths).toEqual([
      `${BASE}/comment-1`,
      `${BASE}/comment-1/images/image-9`,
      `${BASE}/comment-1/images`,
    ]);
  });

  it('imports a URL image through the from-url endpoint', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({
      values: values({ newImages: [pendingUrl('https://example.com/map.png')] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/comment-1/images/from-url`, {
      method: 'POST',
      json: { url: 'https://example.com/map.png' },
    });
  });

  it('uploads a local file as multipart', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({ values: values({ newImages: [pendingFile('a.png')] }) });

    const call = fetchMock.mock.calls.find(([path]) => path === `${BASE}/comment-1/images`);
    const init = call?.[1] as { formData: FormData };
    expect((init.formData.get('file') as File).name).toBe('a.png');
  });

  // The Comment itself is already saved at this point; losing the text
  // because an image failed would be the worse outcome.
  it('reports an image failure without failing the save', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === `${BASE}/comment-1/images`
        ? Promise.reject(new Error('Too many images'))
        : Promise.resolve(rawComment()),
    );

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    const saved = await result.current.mutateAsync({
      values: values({ newImages: [pendingFile('a.png')] }),
    });

    expect(saved.commentId).toBe('comment-1');
    expect(saved.imageErrors).toEqual(['a.png: Too many images']);
  });

  it('reports a failed removal the same way', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === `${BASE}/comment-1/images/image-9`
        ? Promise.reject(new Error('Storage down'))
        : Promise.resolve(rawComment()),
    );

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    const saved = await result.current.mutateAsync({
      commentId: 'comment-1',
      values: values({ removedImageIds: ['image-9'] }),
    });

    expect(saved.imageErrors).toEqual(['Rimozione immagine: Storage down']);
  });

  it('reports a non-Error failure by its string form', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === `${BASE}/comment-1/images/image-9` ? Promise.reject('rate limited') : Promise.resolve(rawComment()),
    );

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    const saved = await result.current.mutateAsync({
      commentId: 'comment-1',
      values: values({ removedImageIds: ['image-9'] }),
    });

    expect(saved.imageErrors).toEqual(['Rimozione immagine: rate limited']);
  });

  it('keeps going after one image fails, so the rest still attach', async () => {
    fetchMock.mockImplementation((_path: string, init?: { formData?: FormData }) => {
      const name = (init?.formData?.get('file') as File | null)?.name;
      return name === 'a.png'
        ? Promise.reject(new Error('Rejected'))
        : Promise.resolve(rawComment());
    });

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    const saved = await result.current.mutateAsync({
      values: values({ newImages: [pendingFile('a.png'), pendingFile('b.png')] }),
    });

    expect(saved.imageErrors).toEqual(['a.png: Rejected']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails the whole mutation when the Comment itself cannot be saved', async () => {
    fetchMock.mockRejectedValue(new Error('Body cannot be blank'));

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));

    await expect(result.current.mutateAsync({ values: values({ body: '' }) })).rejects.toThrow(
      'Body cannot be blank',
    );
  });

  it('refreshes the Document subtree even when the save failed', async () => {
    fetchMock.mockRejectedValue(new Error('nope'));
    const { result, queryClient } = renderHookWithProviders(() =>
      useSaveComment('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await expect(result.current.mutateAsync({ values: values() })).rejects.toThrow();

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: THREAD_KEY }));
  });
});

describe('useDeleteComment', () => {
  it('deletes the Comment and refreshes the Document subtree', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() =>
      useDeleteComment('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('comment-1');

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/comment-1`, { method: 'DELETE' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: THREAD_KEY }));
  });
});

describe('writing in character', () => {
  it('sends the Character to write as', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({ values: { ...values(), asDocumentId: 'doc-2' } });

    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: expect.objectContaining({ as_document_id: 'doc-2' }),
    });
  });

  // Undefined keeps an edited Comment's Character: it must not be sent as
  // null, which would turn the Comment back into a plain one.
  it('leaves the Character out of the request when it is undefined', async () => {
    fetchMock.mockResolvedValue(rawComment());

    const { result } = renderHookWithProviders(() => useSaveComment('room-1', 'doc-1'));
    await result.current.mutateAsync({ commentId: 'comment-1', values: values() });

    const json = (fetchMock.mock.calls[0][1] as { json: object }).json;
    expect(JSON.parse(JSON.stringify(json))).not.toHaveProperty('as_document_id');
  });
});
