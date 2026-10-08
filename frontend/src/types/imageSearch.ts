/** One free image from the image search (spec 29), with its credit. */
export interface ImageSearchResult {
  id: string;
  /** Always on Openverse, never the upstream host (spec 29 Decision 6). */
  thumbnailUrl: string;
  /** The full image, imported through "Da URL"'s endpoint. */
  url: string;
  width: number | null;
  height: number | null;
  title: string | null;
  creator: string | null;
  license: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
}

/** A page of results, and whether a next page can be asked for. */
export interface ImageSearchPage {
  results: ImageSearchResult[];
  page: number;
  hasMore: boolean;
}
