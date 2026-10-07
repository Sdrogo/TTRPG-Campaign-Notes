import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coverChoices,
  DEFAULT_PDF_OPTIONS,
  isActivePdfJob,
  listedPdfJobs,
  PDF_LINK_WAIT_MS,
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
      room_cover: true,
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
          roomCover: false,
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
      room_cover: false,
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

  it('stops waiting for a link that has not come two minutes after the job finished', () => {
    const finished = Date.parse('2026-10-05T12:01:00Z');
    const waiting = [job({ status: 'done', finishedAt: '2026-10-05T12:01:00Z' })];

    expect(pdfPollInterval(waiting, finished + PDF_LINK_WAIT_MS - 1)).toBe(PDF_POLL_INTERVAL_MS);
    expect(pdfPollInterval(waiting, finished + PDF_LINK_WAIT_MS)).toBe(false);
    // Without a finish time it counts from creation.
    const unknown = [job({ status: 'done', finishedAt: null, createdAt: '2026-10-05T12:00:00Z' })];
    expect(pdfPollInterval(unknown, Date.parse('2026-10-05T12:00:30Z'))).toBe(PDF_POLL_INTERVAL_MS);
    expect(pdfPollInterval(unknown, Date.parse('2026-10-05T12:05:00Z'))).toBe(false);
  });

  it('polls while a job is active, or done with no download link yet, and otherwise stops', () => {
    expect(pdfPollInterval(undefined)).toBe(false);
    expect(pdfPollInterval([])).toBe(false);
    expect(pdfPollInterval([job({ status: 'running' })])).toBe(PDF_POLL_INTERVAL_MS);
    const justDone = job({ status: 'done', downloadUrl: null, finishedAt: new Date().toISOString() });
    expect(pdfPollInterval([justDone])).toBe(PDF_POLL_INTERVAL_MS);
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
    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual([]);

    saveDismissedPdfJob('user-1', 'room-1', 'a');
    const after = saveDismissedPdfJob('user-1', 'room-1', 'b');

    expect([...after]).toEqual(['a', 'b']);
    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual(['a', 'b']);
    expect([...readDismissedPdfJobs('user-1', 'room-2')]).toEqual([]);
    // Another user of the same browser has their own list.
    expect([...readDismissedPdfJobs('user-2', 'room-1')]).toEqual([]);
  });

  it('keeps only the newest fifty', () => {
    for (let n = 0; n < 55; n += 1) saveDismissedPdfJob('user-1', 'room-1', `job-${n}`);

    const kept = [...readDismissedPdfJobs('user-1', 'room-1')];

    expect(kept).toHaveLength(50);
    expect(kept[0]).toBe('job-5');
    expect(kept.at(-1)).toBe('job-54');
  });

  it('starts empty when what is stored is damaged or not a list', () => {
    localStorage.setItem('pdfDismissed:user-1:room-1', '{not json');
    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual([]);

    localStorage.setItem('pdfDismissed:user-1:room-1', '{"a":1}');
    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual([]);

    localStorage.setItem('pdfDismissed:user-1:room-1', '["a", 3, null, "b"]');
    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual(['a', 'b']);
  });

  it('still works for this visit when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect([...readDismissedPdfJobs('user-1', 'room-1')]).toEqual([]);
    expect([...saveDismissedPdfJob('user-1', 'room-1', 'a')]).toEqual(['a']);
  });
});
