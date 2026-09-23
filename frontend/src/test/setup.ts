import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements none of these, and Mantine's primitives (Modal, Select,
// Carousel, anything responsive) call them during a normal render.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver ??= ObserverStub;
// Embla, behind Mantine's Carousel, sets one up on mount.
globalThis.IntersectionObserver ??= ObserverStub as unknown as typeof IntersectionObserver;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// Pointer capture is used by Mantine's Combobox/Select; jsdom has no
// implementation and user-event calls it while simulating a click.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// Mantine's autosize Textarea re-measures when webfonts finish loading;
// jsdom has no FontFaceSet at all.
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
  });
}

// `URL.createObjectURL` backs every image preview in the app. The
// environment does provide one, but it throws on a File built inside a test
// ("Cannot read properties of undefined (reading '_buffer')"), so this
// replaces it outright rather than filling a gap. A real blob: URL would
// mean nothing here; the previews only need a stable, unique string.
let objectUrlCount = 0;
globalThis.URL.createObjectURL = () => `blob:preview-${++objectUrlCount}`;
globalThis.URL.revokeObjectURL = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
