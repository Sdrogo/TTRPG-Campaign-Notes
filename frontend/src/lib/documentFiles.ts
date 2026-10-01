import { currentLanguage } from '../i18n';
import type { DocumentFile } from '../types/documentFile';

/** The biggest PDF the backend accepts (`MAX_FILE_BYTES`, D-22). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How many PDFs a Document may hold (`MAX_FILES_PER_DOCUMENT`, D-22). */
export const MAX_FILES_PER_DOCUMENT = 10;

/** What the upload picker offers. The backend checks the bytes, not this. */
export const ACCEPTED_FILE_TYPES = 'application/pdf';

/** An Attachment as the backend sends it. */
export interface RawDocumentFile {
  id: string;
  document_id: string;
  name: string;
  size_bytes: number;
  content_type: string;
  uploaded_by: string;
  created_at: string;
  url: string;
  can_delete: boolean;
}

/** Maps the wire shape to the app's `DocumentFile`. */
export function toDocumentFile(raw: RawDocumentFile): DocumentFile {
  return {
    id: raw.id,
    documentId: raw.document_id,
    name: raw.name,
    sizeBytes: raw.size_bytes,
    contentType: raw.content_type,
    uploadedBy: raw.uploaded_by,
    createdAt: raw.created_at,
    url: raw.url,
    canDelete: raw.can_delete,
  };
}

/** Why a picked file can't be uploaded, as the i18n key to show. */
export type FileProblem = 'files.notPdf' | 'files.tooLarge';

/**
 * Early feedback before an upload, so an obvious mistake doesn't cost a
 * 10 MB round trip. Only a hint: the backend decides by the file's content
 * (spec 16), and some systems report a PDF with an empty type, so the name is
 * accepted as a fallback.
 */
export function pdfProblem(file: File): FileProblem | null {
  const looksLikePdf =
    file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name));
  if (!looksLikePdf) {
    return 'files.notPdf';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'files.tooLarge';
  }
  return null;
}

/** "512 kB", "2.4 MB" in the UI language. */
export function formatFileSize(bytes: number): string {
  const [value, unit] =
    bytes >= 1024 * 1024 ? [bytes / (1024 * 1024), 'megabyte'] : [Math.max(bytes / 1024, 1), 'kilobyte'];
  return new Intl.NumberFormat(currentLanguage(), {
    style: 'unit',
    unit,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

/**
 * Opens a PDF in the browser's own viewer. The signed link downloads by
 * design (D-22), so the bytes are fetched and shown from a `blob:` URL
 * instead, as spec 16 prescribes. The tab is opened before the fetch,
 * while the click still counts as a user gesture, or the popup blocker
 * would stop it; it is closed again if the fetch fails.
 */
export async function openPdf(url: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText || String(response.status));
    }
    const blob = new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = blobUrl;
    } else {
      window.location.assign(blobUrl);
    }
    // The viewer has loaded the bytes long before this; freeing them earlier
    // could blank a slow tab.
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
