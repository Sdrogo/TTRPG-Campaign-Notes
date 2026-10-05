import { Box, Mark, SimpleGrid, Stack, Text } from '@mantine/core';
import { compareTexts, type DiffPart } from '../../lib/versions';
import { useTranslation } from 'react-i18next';

interface VersionDiffProps {
  /** The version being compared: the left side (above, on a phone). */
  before: { title: string; description: string };
  /** The text in force now: the right side. */
  after: { title: string; description: string };
  beforeLabel: string;
  afterLabel: string;
}

function Parts({ parts, tone }: { parts: DiffPart[]; tone: 'red' | 'green' }) {
  return (
    <>
      {parts.map((part, index) =>
        part.changed ? (
          <Mark key={index} color={tone}>
            {part.text}
          </Mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A version against the current text, side by side (spec 24 Decision 4): the
 * words the current text lacks are marked in red on the left, the words it
 * added in green on the right. On a phone the two stack, old above, new below.
 * The title and the description are compared on their own.
 */
export function VersionDiff({ before, after, beforeLabel, afterLabel }: VersionDiffProps) {
  const { t } = useTranslation();
  const title = compareTexts(before.title, after.title);
  const description = compareTexts(before.description, after.description);
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" data-testid="version-diff">
      {(
        [
          {
            label: beforeLabel,
            tone: 'red',
            title: title.before,
            description: description.before,
          },
          {
            label: afterLabel,
            tone: 'green',
            title: title.after,
            description: description.after,
          },
        ] as const
      ).map((side) => (
        <Stack key={side.tone} gap={4} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {side.label}
          </Text>
          <Box
            p="sm"
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-md)',
            }}
          >
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              <Parts parts={side.title} tone={side.tone} />
            </Text>
            {side.description.length > 0 ? (
              <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <Parts parts={side.description} tone={side.tone} />
              </Text>
            ) : (
              <Text size="sm" c="dimmed" mt={4}>
                {t('common.noDescription')}
              </Text>
            )}
          </Box>
        </Stack>
      ))}
    </SimpleGrid>
  );
}
