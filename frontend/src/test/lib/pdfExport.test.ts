import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coverChoices,
  DEFAULT_PDF_OPTIONS,
  isActivePdfJob,
  listedPdfJobs,
  PDF_POLL_INTERVAL_MS,
  pdfPollInterval,
  pdfRequestBody,
  readDismissedPdfJobs,
  saveDismissedPdfJob,
  toPdfJob,
  type PdfJob,
} from '../../lib/pdfExport';
import type { Document } from '../../types/document';
import { rawPdfJob } from '../fixtures';

const job = (overrides: Partial<PdfJob> = {}): PdfJob => ({
  ...toPdfJob(rawPdfJob() as Parameters<typeof toPdfJob>[0]),
  ...overrides,
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('toPdfJob', () => {
  it('maps the wire names', () => {
    const mapped = toPdfJob(
      rawPdfJob({
        id: 'j',
        status: 'done',
        style: 'print',
        page_size: 'Letter',
        finished_at: '2026-10-05T12:01:00Z',
        expires_at: '2026-10-06T12:01:00Z',
        download_url: 'https://signed.test/x.pdf',
      }) as Parameters<typeof toPdfJob>[0],
    );

    expect(mapped).toEqual({
      id: 'j',
      status: 'done',
      style: 'print',
      pageSize: 'Letter',
      createdAt: '2026-10-05T12:00:00Z',
      finishedAt: '2026-10-05T12:01:00Z',
      expiresAt: '2026-10-06T12:01:00Z',
      downloadUrl: 'https://signed.test/x.pdf',
    });
  });
});

describe('pdfRequestBody', () => {
  it('starts from Gothic, A4 and nothing optional (spec 23b Decisions 2, 4, 5, 7)', () => {
    expect(pdfRequestBody(DEFAULT_PDF_OPTIONS, null)).toEqual({
      style: 'gothic',
      page_size: 'A4',
      include_comments: false,
      include_attachments: false,
      cover_document_id: null,
      tag_ids: [],
      view_as_user_id: null,
    });
  });

  it('carries every choice, and the member being previewed in the body (spec 22b)', () => {
    expect(
      pdfRequestBody(
        {
          style: 'print',
          pageSize: 'Letter',
          includeComments: true,
          includeAttachments: true,
          coverDocumentId: 'doc-1',
          tagIds: ['t1', 't2'],
        },
        'alice',
      ),
    ).toEqual({
      style: 'print',
      page_size: 'Letter',
      include_comments: true,
      include_attachments: true,
      cover_document_id: 'doc-1',
      tag_ids: ['t1', 't2'],
      view_as_user_id: 'alice',
    });
  });
});

describe('polling', () => {
  it('knows which jobs are still being made', () => {
    expect(isActivePdfJob(job({ status: 'queued' }))).toBe(true);
    expect(isActivePdfJob(job({ status: 'running' }))).toBe(true);
    for (const status of ['done', 'failed', 'expired'] as const) {
      expect(isActivePdfJob(job({ status }))).toBe(false);
    }
  });

  it('polls while a job is active, or done with no download link yet, and otherwise stops', () => {
    expect(pdfPollInterval(undefined)).toBe(false);
    expect(pdfPollInterval([])).toBe(false);
    expect(pdfPollInterval([job({ status: 'running' })])).toBe(PDF_POLL_INTERVAL_MS);
    expect(pdfPollInterval([job({ status: 'done', downloadUrl: null })])).toBe(
      PDF_POLL_INTERVAL_MS,
    );
    expect(pdfPollInterval([job({ status: 'done', downloadUrl: 'https://x/y.pdf' })])).toBe(false);
    expect(pdfPollInterval([job({ status: 'failed' }), job({ status: 'expired' })])).toBe(false);
  });
});

describe('coverChoices', () => {
  it('offers only the Documents that have an image', () => {
    const documents = [
      { id: 'a', name: 'Con immagine', images: [{ id: 'i', url: 'u', isFavorite: true }] },
      { id: 'b', name: 'Senza', images: [] },
    ] as unknown as Document[];

    expect(coverChoices(documents)).toEqual([{ value: 'a', label: 'Con immagine' }]);
  });
});

describe('listedPdfJobs', () => {
  it('drops expired and dismissed jobs', () => {
    const jobs = [
      job({ id: 'a' }),
      job({ id: 'b', status: 'expired' }),
      job({ id: 'c', status: 'done' }),
      job({ id: 'd', status: 'failed' }),
    ];

    expect(listedPdfJobs(jobs, new Set(['c'])).map((j) => j.id)).toEqual(['a', 'd']);
  });
});

describe('dismissed jobs in the browser', () => {
  it('remembers a job per Room', () => {
    expect([...readDismissedPdfJobs('room-1')]).toEqual([]);

    saveDismissedPdfJob('room-1', 'a');
    const after = saveDismissedPdfJob('room-1', 'b');

    expect([...after]).toEqual(['a', 'b']);
    expect([...readDismissedPdfJobs('room-1')]).toEqual(['a', 'b']);
    expect([...readDismissedPdfJobs('room-2')]).toEqual([]);
  });

  it('keeps only the newest fifty', () => {
    for (let n = 0; n < 55; n += 1) saveDismissedPdfJob('room-1', `job-${n}`);

    const kept = [...readDismissedPdfJobs('room-1')];

    expect(kept).toHaveLength(50);
    expect(kept[0]).toBe('job-5');
    expect(kept.at(-1)).toBe('job-54');
  });

  it('starts empty when what is stored is damaged or not a list', () => {
    localStorage.setItem('pdfDismissed:room-1', '{not json');
    expect([...readDismissedPdfJobs('room-1')]).toEqual([]);

    localStorage.setItem('pdfDismissed:room-1', '{"a":1}');
    expect([...readDismissedPdfJobs('room-1')]).toEqual([]);

    localStorage.setItem('pdfDismissed:room-1', '["a", 3, null, "b"]');
    expect([...readDismissedPdfJobs('room-1')]).toEqual(['a', 'b']);
  });

  it('still works for this visit when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect([...readDismissedPdfJobs('room-1')]).toEqual([]);
    expect([...saveDismissedPdfJob('room-1', 'a')]).toEqual(['a']);
  });
});
