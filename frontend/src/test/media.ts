import { vi } from 'vitest';

/** Makes `window.matchMedia` match exactly `queries`; returns a restore function. */
export function matchMediaQueries(queries: string[]): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: queries.includes(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
