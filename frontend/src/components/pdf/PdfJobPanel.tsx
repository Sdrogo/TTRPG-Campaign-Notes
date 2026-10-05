import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { isActivePdfJob, type PdfJob } from '../../lib/pdfExport';
import { formatAbsoluteTime } from '../../lib/time';

interface PdfJobPanelProps {
  job: PdfJob;
  /** Called when the user takes the file, so the Room page stops listing it. */
  onDownload: (jobId: string) => void;
  /** Goes back to the form for another PDF; offered once the job is over. */
  onNew: () => void;
}

/**
 * Where one PDF is (spec 23b Frontend): being made (it can be left, the Room
 * page keeps it), ready to download until the day the file is removed, failed,
 * or expired. The download is a plain link to the signed address, which Storage
 * serves as an attachment, so it never opens from the app's own origin.
 */
export function PdfJobPanel({ job, onDownload, onNew }: PdfJobPanelProps) {
  const { t } = useTranslation();

  if (isActivePdfJob(job)) {
    return (
      <Stack gap="xs" role="status">
        <Group gap="sm" wrap="nowrap">
          <Loader size="sm" />
          <Text size="sm" fw={500}>
            {t('export.pdf.making')}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t('export.pdf.makingHint')}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {job.status === 'done' && (
        <>
          <Text size="sm" fw={500}>
            {t('export.pdf.ready')}
          </Text>
          {job.expiresAt && (
            <Text size="xs" c="dimmed">
              {t('export.pdf.availableUntil', { time: formatAbsoluteTime(job.expiresAt) })}
            </Text>
          )}
          {job.downloadUrl ? (
            <Button
              component="a"
              href={job.downloadUrl}
              onClick={() => onDownload(job.id)}
              leftSection={<DownloadSimpleIcon size={16} />}
            >
              {t('export.pdf.download')}
            </Button>
          ) : (
            <Group gap="sm" wrap="nowrap" role="status">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                {t('export.pdf.preparingLink')}
              </Text>
            </Group>
          )}
        </>
      )}
      {job.status === 'failed' && (
        <Alert color="red" role="alert">
          {t('export.pdf.failed')}
        </Alert>
      )}
      {job.status === 'expired' && <Text size="sm">{t('export.pdf.expired')}</Text>}
      <Button variant="light" onClick={onNew}>
        {t(job.status === 'failed' ? 'export.pdf.retry' : 'export.pdf.another')}
      </Button>
    </Stack>
  );
}
