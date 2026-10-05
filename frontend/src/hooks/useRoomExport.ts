import { useMutation } from '@tanstack/react-query';
import { apiDownload } from '../lib/apiClient';
import { exportFileName, exportPath, saveBlob, type ExportFormat } from '../lib/roomExport';

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
