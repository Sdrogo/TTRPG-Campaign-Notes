import { Badge, Checkbox, Group, Stack, Text } from '@mantine/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  ImportPreview,
  ImportPreviewDocument,
  ImportPreviewMap,
} from '../../lib/documentImport';

interface ImportReviewStepProps {
  preview: ImportPreview;
  /** The keys of the Documents ticked to import. */
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** The keys of the maps ticked to import (spec 40). */
  selectedMaps: Set<string>;
  onToggleMap: (key: string) => void;
}

/** One line of what a Document would bring: Notes and images, then its Tags. */
function documentDetail(
  document: ImportPreviewDocument,
  t: TFunction,
): string {
  const parts = [
    t('documentImport.notesCount', { count: document.notesCount }),
    t('documentImport.imagesCount', { count: document.imagesCount }),
  ];
  if (document.tagNames.length > 0) {
    parts.push(t('documentImport.tags', { names: document.tagNames.join(', ') }));
  }
  return parts.join(' · ');
}

/** One line of what a map would bring: its kind and how many Documents it places. */
function mapDetail(found: ImportPreviewMap, t: TFunction): string {
  return [
    t(`documentImport.maps.kind.${found.kind}`),
    t('documentImport.maps.documentsCount', { count: found.documentsCount }),
  ].join(' · ');
}

/**
 * What the files hold (spec 27 Decision 9): every Document with a tick to leave
 * it out, what it brings, whether it already exists in the Room, and what is
 * dropped or changed about it. Then the Tags the import would create or can't,
 * and the maps of the files (spec 40), each with a tick, what it leaves out, or
 * why it can't be created (no tick then). The wording of each warning is here;
 * whether it applies is the backend's.
 */
export function ImportReviewStep({
  preview,
  selected,
  onToggle,
  selectedMaps,
  onToggleMap,
}: ImportReviewStepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        {t('documentImport.found', { count: preview.documents.length })}
      </Text>
      <Stack gap="xs" mah={320} style={{ overflowY: 'auto' }}>
        {preview.documents.map((document) => (
          <Stack key={document.key} gap={2}>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Checkbox
                checked={selected.has(document.key)}
                onChange={() => onToggle(document.key)}
                aria-label={t('documentImport.documentSelect', { name: document.name })}
                mt={2}
              />
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Group gap="xs">
                  <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                    {document.name}
                  </Text>
                  {document.existingDocumentId !== null && (
                    <Badge size="xs" variant="light">
                      {t('documentImport.exists')}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {documentDetail(document, t)}
                </Text>
                {document.warnings.map((warning) => (
                  <Text key={warning.code} size="xs" c="yellow">
                    {t(`documentImport.warning.${warning.code}`, {
                      count: warning.count,
                      names: warning.names.join(', '),
                    })}
                  </Text>
                ))}
              </Stack>
            </Group>
          </Stack>
        ))}
      </Stack>
      {preview.tagsToCreate.length > 0 && (
        <Text size="xs" c="dimmed">
          {t('documentImport.tagsToCreate', {
            names: preview.tagsToCreate.map((tag) => tag.name).join(', '),
          })}
        </Text>
      )}
      {preview.unavailableTags.length > 0 && (
        <Text size="xs" c="dimmed">
          {t('documentImport.tagsUnavailable', { names: preview.unavailableTags.join(', ') })}
        </Text>
      )}
      {preview.maps.length > 0 && (
        <>
          <Text size="sm" fw={500}>
            {t('documentImport.maps.found', { count: preview.maps.length })}
          </Text>
          <Stack gap="xs" mah={200} style={{ overflowY: 'auto' }}>
            {preview.maps.map((found) => (
              <Group key={found.key} gap="xs" wrap="nowrap" align="flex-start">
                <Checkbox
                  checked={found.skipped === null && selectedMaps.has(found.key)}
                  disabled={found.skipped !== null}
                  onChange={() => onToggleMap(found.key)}
                  aria-label={t('documentImport.maps.select', {
                    name: found.name || t('documentImport.maps.unnamed'),
                  })}
                  mt={2}
                />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                    {found.name || t('documentImport.maps.unnamed')}
                  </Text>
                  {found.skipped === null ? (
                    <Text size="xs" c="dimmed">
                      {mapDetail(found, t)}
                    </Text>
                  ) : (
                    <Text size="xs" c="yellow">
                      {t(`documentImport.maps.skipReason.${found.skipped}`)}
                    </Text>
                  )}
                  {found.warnings.map((warning) => (
                    <Text key={warning.code} size="xs" c="yellow">
                      {t(`documentImport.maps.warning.${warning.code}`, { count: warning.count })}
                    </Text>
                  ))}
                </Stack>
              </Group>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
