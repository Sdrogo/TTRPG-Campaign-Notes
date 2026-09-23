import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawDocument, rawImage } from '../test/fixtures';
import { renderHookWithProviders } from '../test/utils';
import {
  useAddDocumentOwner,
  useCreateDocument,
  useDeleteDocumentImage,
  useDocument,
  useDocuments,
  useImportDocumentImage,
  useRemoveDocumentOwner,
  useSetFavoriteImage,
  useUpdateDocument,
  useUploadDocumentImages,
} from './useDocuments';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const LIST_KEY = ['rooms', 'room-1', 'documents'];
const DETAIL_KEY = ['rooms', 'room-1', 'documents', 'doc-1'];

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useDocuments', () => {
  it('maps the wire shape onto the Document model', async () => {
    fetchMock.mockResolvedValue([rawDocument()]);

    const { result } = renderHookWithProviders(() => useDocuments('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents');
    expect(result.current.data?.[0]).toEqual({
      id: 'doc-1',
      roomId: 'room-1',
      name: 'Il Cancello',
      description: 'Una porta di pietra.',
      visibility: 'room',
      images: [{ id: 'image-1', url: 'http://signed/image-1.webp', isFavorite: false }],
      tagIds: ['tag-1'],
      ownerIds: ['user-1'],
      selectiveUserIds: [],
    });
  });

  // The backend orders the gallery favorite-first and the hook must not
  // re-sort it, or the card and the detail page could disagree (spec 07).
  it('preserves the order the backend sent the images in', async () => {
    fetchMock.mockResolvedValue([
      rawDocument({
        images: [
          rawImage({ id: 'image-2', is_favorite: true }),
          rawImage({ id: 'image-1', is_favorite: false }),
        ],
      }),
    ]);

    const { result } = renderHookWithProviders(() => useDocuments('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].images.map((image) => image.id)).toEqual([
      'image-2',
      'image-1',
    ]);
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useDocuments('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useDocument', () => {
  it('reads a single Document under its own cache key', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result, queryClient } = renderHookWithProviders(() =>
      useDocument('room-1', 'doc-1', true),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1');
    expect(queryClient.getQueryData(DETAIL_KEY)).toBeDefined();
  });
});

describe('useCreateDocument', () => {
  it('converts the form input to the wire body', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result } = renderHookWithProviders(() => useCreateDocument('room-1'));
    await result.current.mutateAsync({
      name: 'Il Cancello',
      description: 'Una porta.',
      visibility: 'selective',
      tagIds: ['tag-1'],
      selectiveUserIds: ['user-2'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents', {
      method: 'POST',
      json: {
        name: 'Il Cancello',
        description: 'Una porta.',
        visibility: 'selective',
        tag_ids: ['tag-1'],
        selective_user_ids: ['user-2'],
      },
    });
  });

  // The mention popup creates a name-only Document on purpose, so the
  // backend applies its default Room visibility (D-13).
  it('sends only the name when that is all the caller gave', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result } = renderHookWithProviders(() => useCreateDocument('room-1'));
    await result.current.mutateAsync({ name: 'Bozza' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents', {
      method: 'POST',
      json: {
        name: 'Bozza',
        description: undefined,
        visibility: undefined,
        tag_ids: undefined,
        selective_user_ids: undefined,
      },
    });
  });

  it('invalidates the documents list', async () => {
    fetchMock.mockResolvedValue(rawDocument());
    const { result, queryClient } = renderHookWithProviders(() => useCreateDocument('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ name: 'Bozza' });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY }));
  });
});

describe('useUpdateDocument', () => {
  it('patches the Document', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result } = renderHookWithProviders(() => useUpdateDocument('room-1', 'doc-1'));
    await result.current.mutateAsync({ visibility: 'master' });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1', {
      method: 'PATCH',
      json: {
        name: undefined,
        description: undefined,
        visibility: 'master',
        tag_ids: undefined,
        selective_user_ids: undefined,
      },
    });
  });

  it('invalidates both the list and the detail cache', async () => {
    fetchMock.mockResolvedValue(rawDocument());
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateDocument('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ name: 'Nuovo nome' });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });
});

describe('document owners', () => {
  it('adds an Owner and refreshes list and detail', async () => {
    fetchMock.mockResolvedValue(rawDocument({ owner_ids: ['user-1', 'user-2'] }));
    const { result, queryClient } = renderHookWithProviders(() =>
      useAddDocumentOwner('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const document = await result.current.mutateAsync('user-2');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/owners/user-2', {
      method: 'POST',
    });
    expect(document.ownerIds).toEqual(['user-1', 'user-2']);
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });

  it('removes an Owner', async () => {
    fetchMock.mockResolvedValue(undefined);

    const { result } = renderHookWithProviders(() => useRemoveDocumentOwner('room-1', 'doc-1'));
    await result.current.mutateAsync('user-2');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/owners/user-2', {
      method: 'DELETE',
    });
  });
});

describe('useUploadDocumentImages', () => {
  function file(name: string) {
    return new File(['bytes'], name, { type: 'image/png' });
  }

  it('uploads each file as its own multipart request', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result } = renderHookWithProviders(() =>
      useUploadDocumentImages('room-1', 'doc-1'),
    );
    await result.current.mutateAsync([file('a.png'), file('b.png')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [path, init] = fetchMock.mock.calls[0] as [string, { formData: FormData }];
    expect(path).toBe('/rooms/room-1/documents/doc-1/images');
    expect((init.formData.get('file') as File).name).toBe('a.png');
  });

  // Sequential on purpose: the error has to name which file failed, and the
  // ones already uploaded stay uploaded.
  it('stops at the first failure and names the file in the message', async () => {
    fetchMock
      .mockResolvedValueOnce(rawDocument())
      .mockRejectedValueOnce(new Error('Too many images'));

    const { result } = renderHookWithProviders(() =>
      useUploadDocumentImages('room-1', 'doc-1'),
    );

    await expect(
      result.current.mutateAsync([file('a.png'), file('b.png'), file('c.png')]),
    ).rejects.toThrow('b.png: Too many images');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // `onSettled`, not `onSuccess`: a partial upload still changed the gallery.
  it('refreshes the caches even when an upload failed', async () => {
    fetchMock.mockRejectedValue(new Error('Storage down'));
    const { result, queryClient } = renderHookWithProviders(() =>
      useUploadDocumentImages('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await expect(result.current.mutateAsync([file('a.png')])).rejects.toThrow();

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });
});

describe('useImportDocumentImage', () => {
  it('posts the URL to the import endpoint', async () => {
    fetchMock.mockResolvedValue(rawDocument());

    const { result } = renderHookWithProviders(() => useImportDocumentImage('room-1', 'doc-1'));
    await result.current.mutateAsync('https://example.com/map.png');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/images/from-url', {
      method: 'POST',
      json: { url: 'https://example.com/map.png' },
    });
  });
});

describe('useSetFavoriteImage', () => {
  it('PUTs the favorite and refreshes both caches', async () => {
    fetchMock.mockResolvedValue(rawDocument({ images: [rawImage({ is_favorite: true })] }));
    const { result, queryClient } = renderHookWithProviders(() =>
      useSetFavoriteImage('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const document = await result.current.mutateAsync('image-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/documents/doc-1/images/image-1/favorite',
      { method: 'PUT' },
    );
    expect(document.images[0].isFavorite).toBe(true);
    // The card in the list leads with this image too.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });
});

describe('useDeleteDocumentImage', () => {
  it('deletes the image and refreshes both caches', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithProviders(() =>
      useDeleteDocumentImage('room-1', 'doc-1'),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('image-1');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/images/image-1', {
      method: 'DELETE',
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });
});
