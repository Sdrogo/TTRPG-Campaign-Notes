import { useDismissedPdfJobs } from '../../hooks/usePdfExports';
import { useSession } from '../../hooks/useSession';
import type { PdfJob } from '../../lib/pdfExport';
import { PdfJobPanel } from './PdfJobPanel';

/**
 * The panel of the job an Export dialog follows (Room, spec 23b, or one
 * Document, spec 27b). Taking the file is remembered for the signed-in user,
 * so the Room page stops listing it.
 */
export function TrackedPdfJob({
  roomId,
  job,
  onNew,
}: {
  roomId: string;
  job: PdfJob;
  onNew: () => void;
}) {
  const { session } = useSession();
  const { dismiss } = useDismissedPdfJobs(session?.user.id ?? '', roomId);
  return <PdfJobPanel job={job} onDownload={dismiss} onNew={onNew} />;
}
