import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { ImageSearchPage, ImageSearchResult } from '../types/imageSearch';

interface RawImageSearchResult {
  id: string;
  thumbnail_url: string;
  url: string;
  width: number | null;
  height: number | null;
  title: string | null;
  creator: string | null;
  license: string | null;
  license_url: string | null;
  source_url: string | null;
}

interface RawImageSearchPage {
  results: RawImageSearchResult[];
  page: number;
  has_more: boolean;
}

function toResult(raw: RawImageSearchResult): ImageSearchResult {
  return {
    id: raw.id,
    thumbnailUrl: raw.thumbnail_url,
    url: raw.url,
    width: raw.width,
    height: raw.height,
    title: raw.title,
    creator: raw.creator,
    license: raw.license,
    licenseUrl: raw.license_url,
    sourceUrl: raw.source_url,
  };
}

/**
 * Free images for `query` (spec 29, `GET .../image-search`), a page at a
 * time: `fetchNextPage` appends the next one. Sends nothing for an empty
 * query, and isn't retried: a 429 or 502 is shown at once, and retrying
 * would only spend the throttle.
 */
export function useImageSearch(roomId: string, documentId: string, query: string) {
  return useInfiniteQuery<ImageSearchPage, Error, ImageSearchResult[], readonly unknown[], number>({
    queryKey: ['rooms', roomId, 'documents', documentId, 'image-search', query],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ q: query, page: String(pageParam) });
      const raw = await apiFetch<RawImageSearchPage>(
        `/rooms/${roomId}/documents/${documentId}/image-search?${params}`,
      );
      return { results: raw.results.map(toResult), page: raw.page, hasMore: raw.has_more };
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    select: (data) => data.pages.flatMap((page) => page.results),
    enabled: query.length > 0,
    retry: false,
    staleTime: Infinity,
  });
}
