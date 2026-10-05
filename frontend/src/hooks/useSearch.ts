import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { isSearchable } from '../lib/search';
import type {
  Highlighted,
  SearchFilters,
  SearchGroup,
  SearchHit,
  SearchKind,
  SearchResults,
} from '../types/search';

interface RawSearchHit {
  kind: SearchKind;
  id: string;
  document_id: string | null;
  document_name: string | null;
  title: Highlighted | null;
  excerpt: Highlighted | null;
}

interface RawSearchGroup {
  items: RawSearchHit[];
  has_more: boolean;
}

interface RawSearchResults {
  documents: RawSearchGroup;
  notes: RawSearchGroup;
  comments: RawSearchGroup;
  tags: RawSearchGroup;
}

function toHit(raw: RawSearchHit): SearchHit {
  return {
    kind: raw.kind,
    id: raw.id,
    documentId: raw.document_id,
    documentName: raw.document_name,
    title: raw.title,
    excerpt: raw.excerpt,
  };
}

function toGroup(raw: RawSearchGroup): SearchGroup {
  return { items: raw.items.map(toHit), hasMore: raw.has_more };
}

/**
 * Searches the Room (spec 21, `GET /rooms/{id}/search`): Documents, Notes,
 * Comments and Tags matching `query`, grouped by kind, as the viewer may see
 * them (the backend filters). Sends nothing for a query too short to search.
 * While a new query loads, the previous results stay on screen. Keyed under
 * the Room's Documents, so whatever refreshes them after a save refreshes
 * this too.
 */
export function useSearch(roomId: string, query: string, filters: SearchFilters, limit: number) {
  const trimmed = query.trim();
  return useQuery<SearchResults>({
    queryKey: [
      'rooms',
      roomId,
      'documents',
      'search',
      trimmed,
      filters.kind,
      filters.tagIds,
      limit,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
      if (filters.kind) params.set('kind', filters.kind);
      for (const tagId of filters.tagIds) params.append('tag', tagId);
      const raw = await apiFetch<RawSearchResults>(`/rooms/${roomId}/search?${params}`);
      return {
        documents: toGroup(raw.documents),
        notes: toGroup(raw.notes),
        comments: toGroup(raw.comments),
        tags: toGroup(raw.tags),
      };
    },
    enabled: isSearchable(trimmed),
    placeholderData: keepPreviousData,
  });
}
