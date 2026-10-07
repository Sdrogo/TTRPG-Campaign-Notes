import { useState } from 'react';
import { Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { DownloadSimpleIcon, FilePdfIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../hooks/useDocuments';
import { useDismissedPdfJobs, usePdfExports, useStartPdfExport } from '../hooks/usePdfExports';
import { useSession } from '../hooks/useSession';
import { useExportRoom } from '../hooks/useRoomExport';
import { useRoom } from '../hooks/useRooms';
import { useTags } from '../hooks/useTags';
import { useViewAs } from '../hooks/useViewAs';
import { notifyError, notifySuccess } from '../lib/notify';
import { DEFAULT_PDF_OPTIONS, isActivePdfJob, type PdfJob } from '../lib/pdfExport';
import { EXPORT_FORMATS, type ExportFormat } from '../lib/roomExport';
import { PdfExportForm, type PdfFormValue } from './pdf/PdfExportForm';
import { PdfJobPanel } from './pdf/PdfJobPanel';
import { TagFilter } from './TagFilter';

interface ExportRoomModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

/** The formats the dialog offers: the two files of spec 23, then the PDF manual of spec 23b. */
type DialogFormat = ExportFormat | 'pdf';

const DIALOG_FORMATS: DialogFormat[] = [...EXPORT_FORMATS, 'pdf'];

/**
 * The panel of the job the dialog follows. Taking the file is remembered for the
 * signed-in user, so the Room page stops listing it.
 */
function TrackedPdfJob({ roomId, job, onNew }: { roomId: string; job: PdfJob; onNew: () => void }) {
  const { session } = useSession();
  const { dismiss } = useDismissedPdfJobs(session?.user.id ?? '', roomId);
  return <PdfJobPanel job={job} onDownload={dismiss} onNew={onNew} />;
}

/**
 * The Room export dialog (spec 23 Decision 5, spec 23b Frontend): a format
 * (Markdown for people, JSON for tools and Agents, or a PDF laid out as a
 * manual), optionally only the Documents carrying chosen Tags, then a download
 * of what the signed-in user sees. A Markdown or JSON file downloads at once; a
 * PDF is made in the background, so the dialog follows it to "ready" (or the
 * Room page does, once it is closed). While the Master previews the Room as a
 * member (spec 22b) it exports that member's view. The backend decides what
 * goes in; nothing is filtered here.
 */
export function ExportRoomModal({ opened, onClose, roomId }: ExportRoomModalProps) {
  const { t } = useTranslation();
  const room = useRoom(roomId, opened);
  const tags = useTags(roomId, opened);
  const [format, setFormat] = useState<DialogFormat>('md');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [pdfOptions, setPdfOptions] = useState<PdfFormValue>(DEFAULT_PDF_OPTIONS);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const viewAs = useViewAs();
  const exportRoom = useExportRoom(roomId, room.data?.name ?? '');
  const documents = useDocuments(roomId, opened && format === 'pdf');
  const jobs = usePdfExports(roomId, opened && format === 'pdf');
  const startPdf = useStartPdfExport(roomId);

  // The job this dialog follows: the one it started, or one still being made
  // (started from an earlier visit), since only one can run at a time.
  const tracked =
    jobs.data?.find((job) => job.id === startedJobId) ?? jobs.data?.find(isActivePdfJob);

  const handleExport = () => {
    if (format === 'pdf') {
      startPdf.mutate(
        { ...pdfOptions, tagIds },
        { onSuccess: (job) => setStartedJobId(job.id), onError: notifyError },
      );
      return;
    }
    exportRoom.mutate(
      { format, tagIds },
      {
        onSuccess: () => {
          notifySuccess(t('export.done'));
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  const showingJob = format === 'pdf' && tracked !== undefined;

  return (
    <Modal opened={opened} onClose={onClose} title={t('export.title')} centered>
      <Stack gap="md">
        <Text size="sm">{t('export.intro')}</Text>
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
            <TrackedPdfJob
              roomId={roomId}
              job={tracked}
              onNew={() => setStartedJobId(null)}
            />
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
                documents={documents.data ?? []}
                hasRoomImage={Boolean(room.data?.imageUrl)}
              />
            )}
            <TagFilter
              tags={tags.data ?? []}
              value={tagIds}
              onChange={setTagIds}
              aria-label={t('export.tagFilter')}
              placeholder={tagIds.length === 0 ? t('export.tagFilter') : undefined}
            />
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
                  format === 'pdf' ? <FilePdfIcon size={16} /> : <DownloadSimpleIcon size={16} />
                }
                loading={format === 'pdf' ? startPdf.isPending : exportRoom.isPending}
                disabled={!room.data}
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
