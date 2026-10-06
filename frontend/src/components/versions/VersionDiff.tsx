import { Badge, Box, Group, Mark, SimpleGrid, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  compareNotes,
  compareTexts,
  type DiffPart,
  type DocumentText,
  type NoteComparison,
} from '../../lib/versions';

interface VersionDiffProps {
  /** The revision being compared: the left side (above, on a phone). */
  before: DocumentText;
  /** The revision in force now: the right side. */
  after: DocumentText;
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

interface SideProps {
  label: string;
  tone: 'red' | 'green';
  /** The title and description runs, or null when this side has no such Note. */
  text: { title: DiffPart[]; description: DiffPart[] } | null;
  /** Shown instead of the text when it is null. */
  missing: string;
}

function Side({ label, tone, text, missing }: SideProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={4} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Box
        p="sm"
        style={{
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
        }}
      >
        {text === null ? (
          <Text size="sm" c="dimmed" fs="italic">
            {missing}
          </Text>
        ) : (
          <>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              <Parts parts={text.title} tone={tone} />
            </Text>
            {text.description.length > 0 ? (
              <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <Parts parts={text.description} tone={tone} />
              </Text>
            ) : (
              <Text size="sm" c="dimmed" mt={4}>
                {t('common.noDescription')}
              </Text>
            )}
          </>
        )}
      </Box>
    </Stack>
  );
}

function compareNote({ before, after }: NoteComparison) {
  const title = compareTexts(before?.title ?? '', after?.title ?? '');
  const description = compareTexts(before?.description ?? '', after?.description ?? '');
  return {
    before: before && { title: title.before, description: description.before },
    after: after && { title: title.after, description: description.after },
  };
}

/**
 * A revision of a Document against the current one, side by side (spec 24b
 * Decision 4): first the name and the description, then each Note, matched by
 * id. The words the current text lacks are marked in red on the left, the
 * words it added in green on the right; a Note removed since (a restore brings
 * it back) or added since (a restore deletes it) is labelled and has only one
 * side. On a phone the two sides stack, old above, new below.
 */
export function VersionDiff({ before, after, beforeLabel, afterLabel }: VersionDiffProps) {
  const { t } = useTranslation();
  const title = compareTexts(before.title, after.title);
  const description = compareTexts(before.description, after.description);
  const notes = compareNotes(before.notes, after.notes);
  return (
    <Stack gap="lg" data-testid="version-diff">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Side
          label={beforeLabel}
          tone="red"
          text={{ title: title.before, description: description.before }}
          missing=""
        />
        <Side
          label={afterLabel}
          tone="green"
          text={{ title: title.after, description: description.after }}
          missing=""
        />
      </SimpleGrid>
      {notes.length > 0 && (
        <Stack gap="md">
          <Text fw={600} size="sm">
            {t('versions.notesHeading')}
          </Text>
          {notes.map((note) => {
            const sides = compareNote(note);
            return (
              <Stack key={note.id} gap={4}>
                {note.status !== 'kept' && (
                  <Group>
                    <Badge
                      size="xs"
                      variant="light"
                      color={note.status === 'removed' ? 'red' : 'green'}
                    >
                      {t(note.status === 'removed' ? 'versions.noteRemoved' : 'versions.noteAdded')}
                    </Badge>
                  </Group>
                )}
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Side
                    label={beforeLabel}
                    tone="red"
                    text={sides.before}
                    missing={t('versions.noteNotThen')}
                  />
                  <Side
                    label={afterLabel}
                    tone="green"
                    text={sides.after}
                    missing={t('versions.noteNotNow')}
                  />
                </SimpleGrid>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
