import { Alert, Anchor, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isActiveImportJob, type ImportJob } from '../../lib/documentImport';

interface ImportJobPanelProps {
  roomId: string;
  /** The job being followed; undefined until its first read. */
  job: ImportJob | undefined;
  /** Goes back to the first step for more files, once the job is over. */
  onNew: () => void;
}

/**
 * Where the import is (spec 27 Decision 9): running in the background (the
 * dialog can be closed meanwhile), done with the Documents it created or
 * replaced and the maps it created (spec 40) as links, and every image or map
 * it skipped, or failed.
 */
export function ImportJobPanel({ roomId, job, onNew }: ImportJobPanelProps) {
  const { t } = useTranslation();

  if (job === undefined || isActiveImportJob(job)) {
    return (
      <Stack gap="xs" role="status">
        <Group gap="sm" wrap="nowrap">
          <Loader size="sm" />
          <Text size="sm" fw={500}>
            {t('documentImport.running')}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t('documentImport.runningHint')}
        </Text>
      </Stack>
    );
  }

  if (job.status === 'failed' || job.result === null) {
    return (
      <Stack gap="sm">
        <Alert color="red" role="alert">
          {t('documentImport.failed')}
        </Alert>
        <Button variant="light" onClick={onNew}>
          {t('documentImport.another')}
        </Button>
      </Stack>
    );
  }

  const { created, replaced, skipped, maps, skippedMaps } = job.result;
  const documentLinks = (documents: { id: string; name: string }[]) => (
    <Stack gap={2}>
      {documents.map((document) => (
        <Anchor
          key={document.id}
          component={Link}
          to={`/rooms/${roomId}/documents/${document.id}`}
          size="sm"
          style={{ overflowWrap: 'anywhere' }}
        >
          {document.name}
        </Anchor>
      ))}
    </Stack>
  );

  return (
    <Stack gap="sm" role="status">
      <Text size="sm" fw={500}>
        {t('documentImport.done')}
      </Text>
      {created.length > 0 && (
        <>
          <Text size="xs" c="dimmed">
            {t('documentImport.created', { count: created.length })}
          </Text>
          {documentLinks(created)}
        </>
      )}
      {replaced.length > 0 && (
        <>
          <Text size="xs" c="dimmed">
            {t('documentImport.replaced', { count: replaced.length })}
          </Text>
          {documentLinks(replaced)}
        </>
      )}
      {skipped.length > 0 && (
        <>
          <Text size="xs" c="yellow">
            {t('documentImport.skippedTitle', { count: skipped.length })}
          </Text>
          <Stack gap={2}>
            {skipped.map((item) => (
              <Text key={`${item.documentId}-${item.url}`} size="xs" c="dimmed">
                {t('documentImport.skipped', {
                  document: item.documentName,
                  reason: t(`documentImport.skipReason.${item.reason}`),
                })}
              </Text>
            ))}
          </Stack>
        </>
      )}
      {maps.length > 0 && (
        <>
          <Text size="xs" c="dimmed">
            {t('documentImport.maps.created', { count: maps.length })}
          </Text>
          <Stack gap={2}>
            {maps.map((map) => (
              <Anchor
                key={map.id}
                component={Link}
                to={`/rooms/${roomId}/maps/${map.id}`}
                size="sm"
                style={{ overflowWrap: 'anywhere' }}
              >
                {map.name}
              </Anchor>
            ))}
          </Stack>
        </>
      )}
      {skippedMaps.length > 0 && (
        <>
          <Text size="xs" c="yellow">
            {t('documentImport.maps.skippedTitle', { count: skippedMaps.length })}
          </Text>
          <Stack gap={2}>
            {skippedMaps.map((item, index) => (
              <Text key={`${item.name}-${index}`} size="xs" c="dimmed">
                {t('documentImport.skipped', {
                  document: item.name || t('documentImport.maps.unnamed'),
                  reason: t(`documentImport.maps.skipReason.${item.reason}`),
                })}
              </Text>
            ))}
          </Stack>
        </>
      )}
      <Button variant="light" onClick={onNew}>
        {t('documentImport.another')}
      </Button>
    </Stack>
  );
}
