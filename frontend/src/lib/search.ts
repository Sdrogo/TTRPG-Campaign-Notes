import type { Highlighted, SearchHit, SearchKind, SearchResults } from '../types/search';

/** The shortest query the backend searches; anything shorter finds nothing. */
export const MIN_SEARCH_LENGTH = 2;

/** Results per kind by default, and how many "show more" asks for. */
export const RESULTS_PER_KIND = 10;
export const MORE_RESULTS_PER_KIND = 50;

/** The groups in the order the panel lists them (spec 21 Decision 3). */
export const SEARCH_GROUPS: ReadonlyArray<{ kind: SearchKind; key: keyof SearchResults }> = [
  { kind: 'document', key: 'documents' },
  { kind: 'note', key: 'notes' },
  { kind: 'comment', key: 'comments' },
  { kind: 'tag', key: 'tags' },
];

/**
 * Whether `query` is long enough to send: its letters and digits, like the
 * backend counts them, add up to `MIN_SEARCH_LENGTH`.
 */
export function isSearchable(query: string): boolean {
  return (query.match(/[\p{L}\p{N}]/gu) ?? []).length >= MIN_SEARCH_LENGTH;
}

/** A piece of highlighted text, marked or not. */
export interface TextSegment {
  text: string;
  match: boolean;
}

/**
 * `highlighted` cut into plain and matched pieces, in order. Overlapping or
 * out-of-range offsets are clamped rather than trusted.
 */
export function highlightSegments({ text, highlights }: Highlighted): TextSegment[] {
  const segments: TextSegment[] = [];
  let position = 0;
  for (const [rawStart, rawEnd] of [...highlights].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(position, Math.min(rawStart, text.length));
    const end = Math.min(rawEnd, text.length);
    if (end <= start) continue;
    if (start > position) segments.push({ text: text.slice(position, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    position = end;
  }
  if (position < text.length) segments.push({ text: text.slice(position), match: false });
  return segments;
}

/**
 * Where a result leads (Decision 3): the Document; the Note or the Comment on
 * its Document's page, through the anchor that scrolls to it; the Documents
 * list filtered by the Tag.
 */
export function searchHitHref(roomId: string, hit: SearchHit): string {
  if (hit.kind === 'tag') {
    return `/rooms/${roomId}/documents?tag=${hit.id}`;
  }
  const page = `/rooms/${roomId}/documents/${hit.documentId}`;
  if (hit.kind === 'note') return `${page}#note-${hit.id}`;
  if (hit.kind === 'comment') return `${page}#comment-${hit.id}`;
  return page;
}

/** The search shortcut as the keyboard shows it: `⌘ K` on Apple devices, `Ctrl K` elsewhere. */
export function searchShortcutLabel(userAgent: string = navigator.userAgent): string {
  return /Mac|iPhone|iPad/.test(userAgent) ? '⌘ K' : 'Ctrl K';
}
