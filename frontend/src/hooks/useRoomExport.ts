import { useMutation } from '@tanstack/react-query';
import { apiDownload } from '../lib/apiClient';
import {
  documentExportPath,
  exportFileName,
  exportPath,
  saveBlob,
  type ExportFormat,
} from '../lib/roomExport';

/** What to export: the format, and the Tags a Document must all carry (none = the whole Room). */
export interface RoomExportRequest {
  format: ExportFormat;
  tagIds: string[];
}

/**
 * Downloads the Room as a file (spec 23): what the signed-in user sees, or what
 * the member being previewed sees (spec 22b), as JSON or Markdown, named
 * `<room>-<date>.json|md`. Nothing is cached or invalidated: it only reads.
 */
export function useExportRoom(roomId: string, roomName: string) {
  return useMutation({
    mutationFn: async ({ format, tagIds }: RoomExportRequest) => {
      const blob = await apiDownload(exportPath(roomId, format, tagIds));
      saveBlob(blob, exportFileName(roomName, new Date(), format));
    },
  });
}

/**
 * Downloads one Document as a file (spec 27): the Room export with that Document
 * alone, named `<document>-<date>.json|md`, exactly what the signed-in user (or
 * the member being previewed) sees of it. It only reads, so nothing is cached.
 */
export function useExportDocument(roomId: string, documentId: string, documentName: string) {
  return useMutation({
    mutationFn: async (format: ExportFormat) => {
      const blob = await apiDownload(documentExportPath(roomId, documentId, format));
      saveBlob(blob, exportFileName(documentName, new Date(), format, 'document'));
    },
  });
}
