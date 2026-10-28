import { useState } from 'react';
import { Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { DownloadSimpleIcon, FilePdfIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDismissedPdfJobs, usePdfExports, useStartPdfExport } from '../hooks/usePdfExports';
import { useExportDocument } from '../hooks/useRoomExport';
import { useSession } from '../hooks/useSession';
import { useViewAs } from '../hooks/useViewAs';
import { notifyError, notifySuccess } from '../lib/notify';
import { DEFAULT_PDF_OPTIONS, isActivePdfJob, type PdfJob } from '../lib/pdfExport';
import { EXPORT_FORMATS, type ExportFormat } from '../lib/roomExport';
import { PdfExportForm, type PdfFormValue } from './pdf/PdfExportForm';
import { PdfJobPanel } from './pdf/PdfJobPanel';

interface ExportDocumentModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  documentId: string;
  documentName: string;
}

/** The formats the dialog offers: the two files of spec 27, then the PDF of spec 27b. */
type DialogFormat = ExportFormat | 'pdf';

const DIALOG_FORMATS: DialogFormat[] = [...EXPORT_FORMATS, 'pdf'];

/** The panel of the job the dialog follows; taking the file stops the Room page listing it. */
function TrackedPdfJob({ roomId, job, onNew }: { roomId: string; job: PdfJob; onNew: () => void }) {
  const { session } = useSession();
  const { dismiss } = useDismissedPdfJobs(session?.user.id ?? '', roomId);
  return <PdfJobPanel job={job} onDownload={dismiss} onNew={onNew} />;
}

/**
 * The single-Document export dialog (spec 27 Decisions 1 to 4, spec 27b): JSON
 * for tools and for importing it again, Markdown for reading, or a PDF laid out
 * like the Document's pages of the Room manual, then what the signed-in user
 * sees of it (or the member being previewed, spec 22b). A file downloads at
 * once; a PDF is made in the background like the Room's, so the dialog follows
 * it (or the Room page does, once it is closed). The backend decides what goes
 * in; nothing is filtered here.
 */
export function ExportDocumentModal({
  opened,
  onClose,
  roomId,
  documentId,
  documentName,
}: ExportDocumentModalProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<DialogFormat>('md');
  const [pdfOptions, setPdfOptions] = useState<PdfFormValue>(DEFAULT_PDF_OPTIONS);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const viewAs = useViewAs();
  const exportDocument = useExportDocument(roomId, documentId, documentName);
  const jobs = usePdfExports(roomId, opened && format === 'pdf');
  const startPdf = useStartPdfExport(roomId);

  // The job this dialog follows: the one it started, or a PDF of this Document
  // still being made (a Room PDF being made stays on the Room page).
  const tracked =
    jobs.data?.find((job) => job.id === startedJobId) ??
    jobs.data?.find((job) => isActivePdfJob(job) && job.documentId === documentId);

  const handleExport = () => {
    if (format === 'pdf') {
      startPdf.mutate(
        { ...pdfOptions, tagIds: [], documentId },
        { onSuccess: (job) => setStartedJobId(job.id), onError: notifyError },
      );
      return;
    }
    exportDocument.mutate(format, {
      onSuccess: () => {
        notifySuccess(t('export.done'));
        onClose();
      },
      onError: notifyError,
    });
  };

  const showingJob = format === 'pdf' && tracked !== undefined;

  return (
    <Modal opened={opened} onClose={onClose} title={t('export.document.title')} centered>
      <Stack gap="md">
        <Text size="sm">{t('export.document.intro')}</Text>
        <SegmentedControl
          fullWidth
          aria-label={t('export.format')}
          value={format}
          onChange={(value) => setFormat(value as DialogFormat)}
          data={DIALOG_FORMATS.map((value) => ({
            value,
            label: t(`export.formats.${value}`),
          }))}
        />
        <Text size="xs" c="dimmed">
          {t(`export.formatHint.${format}`)}
        </Text>
        {showingJob ? (
          <>
            <TrackedPdfJob roomId={roomId} job={tracked} onNew={() => setStartedJobId(null)} />
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={onClose}>
                {t('common.close')}
              </Button>
            </Group>
          </>
        ) : (
          <>
            {format === 'pdf' && (
              <PdfExportForm
                value={pdfOptions}
                onChange={setPdfOptions}
                documents={[]}
                hasRoomImage={false}
                withCover={false}
              />
            )}
            <Text size="xs" c="dimmed">
              {format === 'pdf'
                ? viewAs
                  ? t('export.pdf.asMember')
                  : t('export.pdf.visibility')
                : t('export.linksExpire')}
            </Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                leftSection={
                  format === 'pdf' ? <FilePdfIcon size={18} /> : <DownloadSimpleIcon size={18} />
                }
                loading={format === 'pdf' ? startPdf.isPending : exportDocument.isPending}
                onClick={handleExport}
              >
                {format === 'pdf' ? t('export.pdf.action') : t('export.action')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
