/** The two formats of the Room export (spec 23), as the backend's `format` parameter. */
export type ExportFormat = 'json' | 'md';

/** The Room export formats, in the order the dialog offers them. */
export const EXPORT_FORMATS: ExportFormat[] = ['md', 'json'];

/** The longest part of a file name taken from the Room's name. */
const MAX_SLUG_LENGTH = 60;

/**
 * `<room>-<date>.json|md` (spec 23 Decision 5): the Room's name reduced to
 * lowercase ASCII letters and digits joined by hyphens, as the backend names
 * its own download, so the file is safe on any system. `room` when nothing is
 * left. The date is UTC, like the backend's.
 */
export function exportFileName(roomName: string, date: Date, format: ExportFormat): string {
  const slug = roomName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return `${slug || 'room'}-${date.toISOString().slice(0, 10)}.${format}`;
}

/** The request path for a Room's export, with one `tag` parameter per Tag. */
export function exportPath(roomId: string, format: ExportFormat, tagIds: string[]): string {
  const params = new URLSearchParams({ format });
  tagIds.forEach((tagId) => params.append('tag', tagId));
  return `/rooms/${roomId}/export?${params.toString()}`;
}

/**
 * Hands `blob` to the browser as a download named `fileName`, through a
 * temporary link, the way a PDF Attachment's bytes are shown from a blob.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has started by the time the click returns; freeing the bytes
  // in the same tick could cancel it in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
