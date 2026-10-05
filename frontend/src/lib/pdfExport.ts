import type { Document } from '../types/document';

/** The built-in looks of the Room PDF (spec 23b Decision 4), as the backend names them. */
export type PdfStyle = 'gothic' | 'modern' | 'print';

/** The paper sizes (spec 23b Decision 5), as the backend names them. */
export type PdfPageSize = 'A4' | 'Letter';

/** Where a PDF job is (spec 23b Decision 8). `expired`: its file was removed after 24 hours. */
export type PdfJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'expired';

/** The styles in the order the dialog offers them: Gothic first (spec 23b Decision 4). */
export const PDF_STYLES: PdfStyle[] = ['gothic', 'modern', 'print'];

/** The page sizes in the order the dialog offers them. */
export const PDF_PAGE_SIZES: PdfPageSize[] = ['A4', 'Letter'];

/** What the requester chooses for a PDF. `coverDocumentId` null = no cover image. */
export interface PdfExportOptions {
  style: PdfStyle;
  pageSize: PdfPageSize;
  includeComments: boolean;
  includeAttachments: boolean;
  coverDocumentId: string | null;
  /** Only the Documents carrying all of these Tags; none = the whole Room. */
  tagIds: string[];
}

/** The dialog's starting choices: Gothic, A4, nothing optional (spec 23b Decisions 2 and 7). */
export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  style: 'gothic',
  pageSize: 'A4',
  includeComments: false,
  includeAttachments: false,
  coverDocumentId: null,
  tagIds: [],
};

/** A Room PDF job as the app uses it. */
export interface PdfJob {
  id: string;
  status: PdfJobStatus;
  style: PdfStyle;
  pageSize: PdfPageSize;
  createdAt: string;
  finishedAt: string | null;
  /** When the file is removed, once it is done. */
  expiresAt: string | null;
  /** A signed link that downloads the file; null until it is done (or while it can't be signed). */
  downloadUrl: string | null;
}

/** A job as the API sends it (`ExportJobResponse`): converted in `toPdfJob` only. */
export interface RawPdfJob {
  id: string;
  status: PdfJobStatus;
  style: PdfStyle;
  page_size: PdfPageSize;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  download_url: string | null;
}

/** Maps the API's job to the app's. */
export function toPdfJob(raw: RawPdfJob): PdfJob {
  return {
    id: raw.id,
    status: raw.status,
    style: raw.style,
    pageSize: raw.page_size,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at,
    expiresAt: raw.expires_at,
    downloadUrl: raw.download_url,
  };
}

/**
 * The body of `POST /rooms/{id}/exports/pdf`. While the Master previews the
 * Room as a member (spec 22b) `viewAsUserId` goes here, not in the
 * `X-View-As` header, which the backend refuses on every write.
 */
export function pdfRequestBody(options: PdfExportOptions, viewAsUserId: string | null) {
  return {
    style: options.style,
    page_size: options.pageSize,
    include_comments: options.includeComments,
    include_attachments: options.includeAttachments,
    cover_document_id: options.coverDocumentId,
    tag_ids: options.tagIds,
    view_as_user_id: viewAsUserId,
  };
}

/** Whether the job is still being made: it is queued or running. */
export function isActivePdfJob(job: PdfJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** How often the job list is read while something is still being made (spec 23b Frontend). */
export const PDF_POLL_INTERVAL_MS = 3000;

/** How long a finished job with no download link yet is waited for before giving up on polling. */
export const PDF_LINK_WAIT_MS = 2 * 60 * 1000;

/**
 * The refetch interval of the job list: every few seconds while a job is
 * active, or done but its download link couldn't be signed yet (the backend
 * answers `download_url` null then) for up to `PDF_LINK_WAIT_MS` after it
 * finished, so a link that never comes doesn't poll for ever; otherwise not
 * at all. The list is read again on window focus either way.
 */
export function pdfPollInterval(
  jobs: PdfJob[] | undefined,
  now: number = Date.now(),
): number | false {
  const waiting = jobs?.some(
    (job) =>
      isActivePdfJob(job) ||
      (job.status === 'done' &&
        job.downloadUrl === null &&
        now - Date.parse(job.finishedAt ?? job.createdAt) < PDF_LINK_WAIT_MS),
  );
  return waiting ? PDF_POLL_INTERVAL_MS : false;
}

/**
 * The Documents offered as the cover: only those with an image, since the
 * cover shows the chosen Document's favorite one (spec 23b Decision 1).
 */
export function coverChoices(documents: Document[]): { value: string; label: string }[] {
  return documents
    .filter((document) => document.images.length > 0)
    .map((document) => ({ value: document.id, label: document.name }));
}

/**
 * The jobs the Room page still lists: not expired and not dismissed (a job is
 * dismissed when its PDF is downloaded, or the user hides it).
 */
export function listedPdfJobs(jobs: PdfJob[], dismissed: ReadonlySet<string>): PdfJob[] {
  return jobs.filter((job) => job.status !== 'expired' && !dismissed.has(job.id));
}

function dismissedKey(userId: string, roomId: string) {
  return `pdfDismissed:${userId}:${roomId}`;
}

/**
 * The jobs of this Room the user downloaded or hid, remembered in the browser
 * (per user, so two people sharing a browser don't hide each other's PDFs) so
 * the Room page stops listing them. A convenience only: storage can be
 * unavailable (private window, blocked site data), so every access is guarded
 * and the job is then simply listed again.
 */
export function readDismissedPdfJobs(userId: string, roomId: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(dismissedKey(userId, roomId)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remembers that `jobId` needn't be listed any more. Keeps the newest 50 so the list can't grow without end. */
export function saveDismissedPdfJob(userId: string, roomId: string, jobId: string): Set<string> {
  const next = new Set([...readDismissedPdfJobs(userId, roomId), jobId]);
  const kept = [...next].slice(-50);
  try {
    localStorage.setItem(dismissedKey(userId, roomId), JSON.stringify(kept));
  } catch {
    // Nothing to do: the job is listed again next time.
  }
  return new Set(kept);
}

/**
 * Miniature colors of each style for the picker's thumbnails: the cover's
 * background, the accent and the page. They mirror the PDF's own stylesheets
 * (backend `app/pdf/styles/`), which is why they are not theme tokens.
 */
export const PDF_STYLE_PREVIEW: Record<PdfStyle, { cover: string; accent: string; page: string }> =
  {
    gothic: { cover: '#0b0b0c', accent: '#8a0f1c', page: '#ffffff' },
    modern: { cover: '#ffffff', accent: '#0f766e', page: '#ffffff' },
    print: { cover: '#ffffff', accent: '#000000', page: '#ffffff' },
  };
