import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentExportPath, exportFileName, exportPath, saveBlob } from '../../lib/roomExport';

const DAY = new Date('2026-10-05T23:30:00Z');

describe('exportFileName', () => {
  it('is the Room and the date, with the format as extension (spec 23 Decision 5)', () => {
    expect(exportFileName('Barovia', DAY, 'json')).toBe('barovia-2026-10-05.json');
    expect(exportFileName('Barovia', DAY, 'md')).toBe('barovia-2026-10-05.md');
  });

  it('reduces the name to ASCII letters and digits, like the backend', () => {
    expect(exportFileName('La Città di Ravenloft!', DAY, 'md')).toBe(
      'la-citta-di-ravenloft-2026-10-05.md',
    );
    expect(exportFileName('  --Curse  of / Strahd--  ', DAY, 'md')).toBe(
      'curse-of-strahd-2026-10-05.md',
    );
  });

  it('falls back to "room" when nothing ASCII is left', () => {
    expect(exportFileName('龍', DAY, 'json')).toBe('room-2026-10-05.json');
    expect(exportFileName('', DAY, 'json')).toBe('room-2026-10-05.json');
  });

  it('cuts a long name without leaving a dangling hyphen', () => {
    const name = `${'a'.repeat(59)} bbbb`;

    expect(exportFileName(name, DAY, 'md')).toBe(`${'a'.repeat(59)}-2026-10-05.md`);
  });
});

describe('exportFileName for one Document (spec 27 Decision 4)', () => {
  it('is named after the Document, with "document" when nothing ASCII is left', () => {
    expect(exportFileName('Il Cancello', DAY, 'json', 'document')).toBe(
      'il-cancello-2026-10-05.json',
    );
    expect(exportFileName('龍', DAY, 'md', 'document')).toBe('document-2026-10-05.md');
  });
});

describe('documentExportPath', () => {
  it('is the Document export route with the format', () => {
    expect(documentExportPath('room-1', 'doc-1', 'md')).toBe(
      '/rooms/room-1/documents/doc-1/export?format=md',
    );
  });
});

describe('exportPath', () => {
  it('asks for the format, and one tag parameter per Tag', () => {
    expect(exportPath('room-1', 'md', [])).toBe('/rooms/room-1/export?format=md');
    expect(exportPath('room-1', 'json', ['t1', 't2'])).toBe(
      '/rooms/room-1/export?format=json&tag=t1&tag=t2',
    );
  });
});

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('downloads the bytes under the given name and frees them afterwards', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:export');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const blob = new Blob(['{}'], { type: 'application/json' });

    saveBlob(blob, 'barovia-2026-10-05.json');

    expect(create).toHaveBeenCalledWith(blob);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('blob:export');
    expect(link.download).toBe('barovia-2026-10-05.json');
    // The temporary link doesn't stay in the page.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:export');
    vi.unstubAllGlobals();
  });
});
