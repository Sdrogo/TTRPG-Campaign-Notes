import { ActionIcon, Group, Loader, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { DownloadSimpleIcon, FilePdfIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDismissedPdfJobs, usePdfExports } from '../../hooks/usePdfExports';
import { isActivePdfJob, listedPdfJobs, type PdfJob } from '../../lib/pdfExport';

/**
 * The Room page's list of the signed-in user's PDFs (spec 23b Frontend): the
 * ones still being made, ready to take, or failed, until downloaded or hidden.
 * Nothing at all when there is none to follow.
 */
export function RoomPdfExports({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const jobs = usePdfExports(roomId, true);
  const { dismissed, dismiss } = useDismissedPdfJobs(roomId);
  const listed = listedPdfJobs(jobs.data ?? [], dismissed);

  if (listed.length === 0) {
    return null;
  }

  return (
    <Paper withBorder p="sm" radius="md" component="section" aria-label={t('export.pdf.listTitle')}>
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          {t('export.pdf.listTitle')}
        </Text>
        {listed.map((job) => (
          <Row key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
        ))}
      </Stack>
    </Paper>
  );
}

function Row({ job, onDismiss }: { job: PdfJob; onDismiss: () => void }) {
  const { t } = useTranslation();
  const label = t('export.pdf.listItem', {
    style: t(`export.pdf.styles.${job.style}`),
    size: job.pageSize,
  });
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        {isActivePdfJob(job) ? (
          <Loader size={16} aria-hidden="true" />
        ) : (
          <FilePdfIcon size={18} aria-hidden="true" />
        )}
        <Text size="sm" truncate>
          {label}
        </Text>
        <Text size="xs" c={job.status === 'failed' ? 'red' : 'dimmed'}>
          {t(`export.pdf.listStatus.${job.status}`)}
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap">
        {job.status === 'done' && job.downloadUrl && (
          <Tooltip label={t('export.pdf.download')}>
            <ActionIcon
              component="a"
              href={job.downloadUrl}
              variant="light"
              onClick={onDismiss}
              aria-label={t('export.pdf.downloadNamed', { name: label })}
            >
              <DownloadSimpleIcon size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {!isActivePdfJob(job) && (
          <Tooltip label={t('export.pdf.dismiss')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onDismiss}
              aria-label={t('export.pdf.dismissNamed', { name: label })}
            >
              <XIcon size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}
