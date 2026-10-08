import { Button, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ImportPreviewDocument, ImportResolution } from '../../lib/documentImport';

interface ImportExistingStepProps {
  /** The ticked Documents that already exist in the Room. */
  documents: ImportPreviewDocument[];
  /** What was chosen per Document key; absent means Copy. */
  resolutions: Record<string, ImportResolution>;
  onChange: (key: string, resolution: ImportResolution) => void;
  /** Sets every Document at once; Replace only where it is allowed. */
  onApplyAll: (resolution: ImportResolution) => void;
}

/**
 * Asked when some of the Documents to import still exist in the Room (spec 27
 * Decisions 5 and 6): Copy makes a new one, Replace rewrites the original's
 * information only. Replace is offered only where the backend said the importer
 * manages that Document (`canReplace`); "apply to all" sets everyone at once.
 */
export function ImportExistingStep({
  documents,
  resolutions,
  onChange,
  onApplyAll,
}: ImportExistingStepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        {t('documentImport.existing.title')}
      </Text>
      <Text size="xs" c="dimmed">
        {t('documentImport.existing.intro')}
      </Text>
      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed">
          {t('documentImport.existing.applyAll')}
        </Text>
        <Button size="compact-xs" variant="light" onClick={() => onApplyAll('copy')}>
          {t('documentImport.existing.copyAll')}
        </Button>
        <Button
          size="compact-xs"
          variant="light"
          disabled={!documents.some((document) => document.canReplace)}
          onClick={() => onApplyAll('replace')}
        >
          {t('documentImport.existing.replaceAll')}
        </Button>
      </Group>
      <Stack gap="xs" mah={280} style={{ overflowY: 'auto' }}>
        {documents.map((document) => (
          <Group key={document.key} justify="space-between" wrap="nowrap" gap="sm">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {document.name}
              </Text>
              {!document.canReplace && (
                <Text size="xs" c="dimmed">
                  {t('documentImport.existing.cannotReplace')}
                </Text>
              )}
            </Stack>
            <SegmentedControl
              size="xs"
              aria-label={t('documentImport.existing.choice', { name: document.name })}
              value={resolutions[document.key] ?? 'copy'}
              onChange={(value) => onChange(document.key, value as ImportResolution)}
              data={[
                { value: 'copy', label: t('documentImport.existing.copy') },
                {
                  value: 'replace',
                  label: t('documentImport.existing.replace'),
                  disabled: !document.canReplace,
                },
              ]}
            />
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
