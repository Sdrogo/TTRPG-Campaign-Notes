import { Badge, Checkbox, Group, Stack, Text } from '@mantine/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  isPageCard,
  type ImportPreview,
  type ImportPreviewDocument,
  type ImportPreviewMap,
  type ImportPreviewSection,
} from '../../lib/documentImport';
import { sectionName } from '../../lib/landingText';

interface ImportReviewStepProps {
  preview: ImportPreview;
  /** The keys of the Documents ticked to import. */
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** The keys of the maps ticked to import (spec 40). */
  selectedMaps: Set<string>;
  onToggleMap: (key: string) => void;
  /** The keys of the Sections ticked (spec 56): custom ones to add, page cards to apply. */
  selectedSections: Set<string>;
  onToggleSection: (key: string) => void;
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

/** One line of what a Section would bring: its blocks (or the card it overwrites), and its image. */
function sectionDetail(found: ImportPreviewSection, t: TFunction): string {
  const parts = [
    isPageCard(found)
      ? t('documentImport.sections.pageCard')
      : t('documentImport.sections.blocksCount', { count: found.blocksCount }),
  ];
  if (found.hasImage) parts.push(t('documentImport.sections.withImage'));
  return parts.join(' · ');
}

/**
 * What the files hold (spec 27 Decision 9): every Document with a tick to leave
 * it out, what it brings, whether it already exists in the Room, and what is
 * dropped or changed about it. Then the Tags the import would create or can't,
 * and the maps of the files (spec 40), each with a tick, what it leaves out, or
 * why it can't be created (no tick then), and for the Master the Sections of
 * the Room home (spec 56): custom ones ticked, page cards unticked (ticking one
 * overwrites this Room's card). The wording of each warning is here;
 * whether it applies is the backend's.
 */
export function ImportReviewStep({
  preview,
  selected,
  onToggle,
  selectedMaps,
  onToggleMap,
  selectedSections,
  onToggleSection,
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
      {preview.sections.length > 0 && (
        <>
          <Text size="sm" fw={500}>
            {t('documentImport.sections.found', { count: preview.sections.length })}
          </Text>
          {preview.sections.some(isPageCard) && (
            <Text size="xs" c="dimmed">
              {t('documentImport.sections.pageCardsHint')}
            </Text>
          )}
          <Stack gap="xs" mah={200} style={{ overflowY: 'auto' }}>
            {preview.sections.map((found) => (
              <Group key={found.key} gap="xs" wrap="nowrap" align="flex-start">
                <Checkbox
                  checked={found.skipped === null && selectedSections.has(found.key)}
                  disabled={found.skipped !== null}
                  onChange={() => onToggleSection(found.key)}
                  aria-label={t(
                    isPageCard(found)
                      ? 'documentImport.sections.applySelect'
                      : 'documentImport.sections.select',
                    { name: sectionName(found) },
                  )}
                  mt={2}
                />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                    {sectionName(found)}
                  </Text>
                  {found.skipped === null ? (
                    <Text size="xs" c="dimmed">
                      {sectionDetail(found, t)}
                    </Text>
                  ) : (
                    <Text size="xs" c="yellow">
                      {t(`documentImport.sections.skipReason.${found.skipped}`)}
                    </Text>
                  )}
                  {found.skippedBlocks > 0 && (
                    <Text size="xs" c="yellow">
                      {t('documentImport.sections.skippedBlocks', { count: found.skippedBlocks })}
                    </Text>
                  )}
                </Stack>
              </Group>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
