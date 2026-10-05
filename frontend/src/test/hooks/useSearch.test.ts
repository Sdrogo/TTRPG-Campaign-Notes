import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { renderHookWithProviders } from '../utils';
import { useSearch } from '../../hooks/useSearch';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const empty = { items: [], has_more: false };

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useSearch', () => {
  it('searches the Room and maps the results from the wire', async () => {
    fetchMock.mockResolvedValue({
      documents: empty,
      notes: {
        items: [
          {
            kind: 'note',
            id: 'note-1',
            document_id: 'doc-1',
            document_name: 'Il Castello',
            title: { text: 'Voci', highlights: [] },
            excerpt: { text: 'Un drago', highlights: [[3, 8]] },
          },
        ],
        has_more: true,
      },
      comments: empty,
      tags: empty,
    });

    const { result } = renderHookWithProviders(() =>
      useSearch('room-1', '  drago ', { kind: null, tagIds: [] }, 10),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/search?q=drago&limit=10');
    expect(result.current.data).toEqual({
      documents: { items: [], hasMore: false },
      notes: {
        items: [
          {
            kind: 'note',
            id: 'note-1',
            documentId: 'doc-1',
            documentName: 'Il Castello',
            title: { text: 'Voci', highlights: [] },
            excerpt: { text: 'Un drago', highlights: [[3, 8]] },
          },
        ],
        hasMore: true,
      },
      comments: { items: [], hasMore: false },
      tags: { items: [], hasMore: false },
    });
  });

  it('sends the kind and every Tag filter', async () => {
    fetchMock.mockResolvedValue({ documents: empty, notes: empty, comments: empty, tags: empty });

    const { result } = renderHookWithProviders(() =>
      useSearch('room-1', 'città', { kind: 'comment', tagIds: ['tag-1', 'tag-2'] }, 50),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/rooms/room-1/search?q=${encodeURIComponent('città')}&limit=50&kind=comment&tag=tag-1&tag=tag-2`,
    );
  });

  // Spec 21 Decision 4: a query under 2 characters finds nothing.
  it('sends nothing for a query too short to search', () => {
    const { result } = renderHookWithProviders(() =>
      useSearch('room-1', 'd', { kind: null, tagIds: [] }, 10),
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
