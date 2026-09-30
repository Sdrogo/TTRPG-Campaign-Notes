import { useState } from 'react';
import { ActionIcon, Button, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { moveItem } from '../../lib/mainTags';
import { sortMainTags, sortTagsByName } from '../../lib/tags';
import type { Tag } from '../../types/tag';

interface MainTagsEditorProps {
  /** Every Tag of the Room, as last saved. */
  tags: Tag[];
  saving: boolean;
  /** Saves the Main Tags as this ordered list of ids. */
  onSave: (tagIds: string[]) => void;
}

/**
 * The Room setup's Main Tags section (spec 11): which Tags the Documents page
 * groups by, and in what order. Edits a local copy of the order - move,
 * remove, add - and saves it as one list, since the backend replaces the whole
 * selection at once. The owner re-keys it on the saved order, so a save or a
 * change made elsewhere resets the draft.
 */
export function MainTagsEditor({ tags, saving, onSave }: MainTagsEditorProps) {
  const { t } = useTranslation();
  const saved = sortMainTags(tags);
  const [draft, setDraft] = useState<Tag[]>(saved);

  const draftIds = draft.map((tag) => tag.id);
  const candidates = sortTagsByName(tags.filter((tag) => !draftIds.includes(tag.id)));
  const dirty = draftIds.join() !== saved.map((tag) => tag.id).join();

  return (
    <Stack gap="sm">
      <Title order={3} style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.mainTags.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.mainTags.description')}
      </Text>

      {draft.length === 0 ? (
        <Text size="sm">{t('setup.mainTags.empty')}</Text>
      ) : (
        <Stack component="ol" gap="xs" p={0} m={0} style={{ listStyle: 'none' }}>
          {draft.map(({ id, name }, index) => (
            <Paper key={id} component="li" withBorder p="xs" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {index + 1}. #{name}
                </Text>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t('setup.mainTags.moveUp', { name })}
                    disabled={index === 0}
                    onClick={() => setDraft(moveItem(draft, index, -1))}
                  >
                    <ArrowUpIcon size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t('setup.mainTags.moveDown', { name })}
                    disabled={index === draft.length - 1}
                    onClick={() => setDraft(moveItem(draft, index, 1))}
                  >
                    <ArrowDownIcon size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t('setup.mainTags.remove', { name })}
                    onClick={() => setDraft(draft.filter((tag) => tag.id !== id))}
                  >
                    <XIcon size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {candidates.length > 0 ? (
        <Select
          label={t('setup.mainTags.addLabel')}
          placeholder={t('setup.mainTags.addPlaceholder')}
          data={candidates.map((tag) => ({ value: tag.id, label: tag.name }))}
          value={null}
          allowDeselect={false}
          // `value` is always one of the candidates: the field never holds a
          // selection, so it can't be deselected either.
          onChange={(value) =>
            setDraft([...draft, candidates.find((tag) => tag.id === value) as Tag])
          }
          searchable
          maw={320}
        />
      ) : (
        <Text size="sm" c="dimmed">
          {t('setup.mainTags.noMoreTags')}
        </Text>
      )}

      <Group>
        <Button onClick={() => onSave(draftIds)} disabled={!dirty} loading={saving}>
          {t('setup.mainTags.save')}
        </Button>
      </Group>
    </Stack>
  );
}
