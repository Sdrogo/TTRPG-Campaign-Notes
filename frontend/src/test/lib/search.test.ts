import { describe, expect, it } from 'vitest';
import {
  highlightSegments,
  isSearchable,
  searchHitHref,
  searchShortcutLabel,
} from '../../lib/search';
import type { SearchHit } from '../../types/search';

function hit(overrides: Partial<SearchHit>): SearchHit {
  return {
    kind: 'document',
    id: 'doc-1',
    documentId: 'doc-1',
    documentName: 'Il Drago',
    title: null,
    excerpt: null,
    ...overrides,
  };
}

describe('isSearchable', () => {
  // Spec 21 Decision 4: under 2 letters or digits finds nothing.
  it('needs two letters or digits, like the backend', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable('d')).toBe(false);
    expect(isSearchable(' ! - ')).toBe(false);
    expect(isSearchable('dr')).toBe(true);
    expect(isSearchable('à 1')).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('cuts the text into plain and matched pieces', () => {
    expect(
      highlightSegments({
        text: 'La Città del Drago',
        highlights: [
          [13, 18],
          [3, 8],
        ],
      }),
    ).toEqual([
      { text: 'La ', match: false },
      { text: 'Città', match: true },
      { text: ' del ', match: false },
      { text: 'Drago', match: true },
    ]);
  });

  it('clamps overlapping and out-of-range offsets', () => {
    expect(
      highlightSegments({
        text: 'drago',
        highlights: [
          [0, 3],
          [1, 2],
          [4, 99],
          [50, 60],
        ],
      }),
    ).toEqual([
      { text: 'dra', match: true },
      { text: 'g', match: false },
      { text: 'o', match: true },
    ]);
    expect(highlightSegments({ text: '', highlights: [] })).toEqual([]);
  });
});

describe('searchHitHref', () => {
  // Decision 3: a click opens the exact place.
  it('leads to the Document, the Note or Comment anchor, or the Tag filter', () => {
    expect(searchHitHref('room-1', hit({}))).toBe('/rooms/room-1/documents/doc-1');
    expect(searchHitHref('room-1', hit({ kind: 'note', id: 'note-1' }))).toBe(
      '/rooms/room-1/documents/doc-1#note-note-1',
    );
    expect(searchHitHref('room-1', hit({ kind: 'comment', id: 'c-1' }))).toBe(
      '/rooms/room-1/documents/doc-1#comment-c-1',
    );
    expect(searchHitHref('room-1', hit({ kind: 'tag', id: 'tag-1', documentId: null }))).toBe(
      '/rooms/room-1/documents?tag=tag-1',
    );
  });
});

describe('searchShortcutLabel', () => {
  it('names Command on Apple devices and Ctrl elsewhere', () => {
    expect(searchShortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('⌘ K');
    expect(searchShortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl K');
    expect(searchShortcutLabel()).toBe('Ctrl K');
  });
});
