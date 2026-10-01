import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../i18n';
import {
  MAX_FILE_BYTES,
  formatFileSize,
  openPdf,
  pdfProblem,
  toDocumentFile,
  type RawDocumentFile,
} from '../../lib/documentFiles';
import { rawDocumentFile } from '../fixtures';

function pick(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('toDocumentFile', () => {
  it('maps the wire shape, keeping the backend-decided can_delete', () => {
    expect(toDocumentFile(rawDocumentFile({ can_delete: false }) as RawDocumentFile)).toEqual({
      id: 'file-1',
      documentId: 'doc-1',
      name: 'Scheda di Aria.pdf',
      sizeBytes: 2_516_582,
      contentType: 'application/pdf',
      uploadedBy: 'user-1',
      createdAt: '2026-10-01T12:00:00Z',
      url: 'https://storage.example/file-1.pdf?token=t&download=Scheda',
      canDelete: false,
    });
  });
});

describe('pdfProblem', () => {
  it('accepts a PDF up to the 10 MB cap (D-22)', () => {
    expect(pdfProblem(pick('scheda.pdf', 'application/pdf', MAX_FILE_BYTES))).toBeNull();
  });

  it('accepts a .pdf whose type the system left empty', () => {
    expect(pdfProblem(pick('SCHEDA.PDF', ''))).toBeNull();
  });

  it('refuses anything that is not a PDF', () => {
    expect(pdfProblem(pick('mappa.png', 'image/png'))).toBe('files.notPdf');
    expect(pdfProblem(pick('note', ''))).toBe('files.notPdf');
  });

  it('refuses a PDF over the cap', () => {
    expect(pdfProblem(pick('scheda.pdf', 'application/pdf', MAX_FILE_BYTES + 1))).toBe(
      'files.tooLarge',
    );
  });
});

describe('formatFileSize', () => {
  it('uses kB under a megabyte and never shows zero', async () => {
    await setLanguage('en');
    expect(formatFileSize(512 * 1024)).toBe('512 kB');
    expect(formatFileSize(10)).toBe('1 kB');
  });

  it('uses MB with one decimal under ten, in the UI language', async () => {
    await setLanguage('en');
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatFileSize(MAX_FILE_BYTES)).toBe('10 MB');
    await setLanguage('it');
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });
});

describe('openPdf', () => {
  const fetchMock = vi.fn();
  let tab: { location: { href: string }; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    tab = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the fetched bytes from a blob URL, never the download link itself', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF-1.7'));

    await openPdf('https://storage.example/f.pdf?download=x');

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/f.pdf?download=x');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf');
    expect(tab.location.href).toBe('blob:pdf');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
  });

  it('falls back to this tab when the popup is blocked', async () => {
    vi.mocked(window.open).mockReturnValue(null);
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    fetchMock.mockResolvedValue(new Response('%PDF-1.7'));

    await openPdf('https://storage.example/f.pdf');

    expect(assign).toHaveBeenCalledWith('blob:pdf');
  });

  it('closes the blank tab and rethrows when the link has expired', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400, statusText: 'Bad Request' }));

    await expect(openPdf('https://storage.example/f.pdf')).rejects.toThrow('Bad Request');
    expect(tab.close).toHaveBeenCalled();
  });

  it('falls back to the status code when there is no status text', async () => {
    vi.mocked(window.open).mockReturnValue(null);
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));

    await expect(openPdf('https://storage.example/f.pdf')).rejects.toThrow('403');
  });
});
