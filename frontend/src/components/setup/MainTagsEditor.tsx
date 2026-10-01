import { useState } from 'react';
import { ActionIcon, Button, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { itemKey, itemLabel, resolveMainItems, sameTagSet } from '../../lib/mainItems';
import { moveItem } from '../../lib/mainTags';
import { sortTagsByName } from '../../lib/tags';
import type { MainItem, Tag } from '../../types/tag';
import { CombinationAdder } from './CombinationAdder';

interface MainTagsEditorProps {
  /** Every Tag of the Room. */
  tags: Tag[];
  /** The Main items as last saved, in order. */
  items: MainItem[];
  saving: boolean;
  /** Saves the Main items in this order. */
  onSave: (items: MainItem[]) => void;
}

/**
 * The Room setup's Main items section (specs 11, 11_2): what the Documents
 * page groups by, and in what order. An item is a single Tag or a combination
 * of two or more (the Documents carrying all of them). Edits a local copy of
 * the list - move, remove, add a Tag, add a combination - and saves it as one
 * list, since the backend replaces the whole selection at once. The owner
 * re-keys it on the saved list, so a save or a change made elsewhere resets
 * the draft.
 */
export function MainTagsEditor({ tags, items, saving, onSave }: MainTagsEditorProps) {
  const { t } = useTranslation();
  const saved = resolveMainItems(items, tags);
  const [draft, setDraft] = useState<Tag[][]>(saved);

  const singleIds = draft.filter((list) => list.length === 1).map((list) => list[0].id);
  const candidates = sortTagsByName(tags.filter((tag) => !singleIds.includes(tag.id)));
  const dirty = draft.map(itemKey).join('|') !== saved.map(itemKey).join('|');

  /** Adds the Tags with these ids as a new last item. */
  const append = (tagIds: string[]) => {
    const added = tagIds.map((id) => tags.find((tag) => tag.id === id) as Tag);
    setDraft([...draft, added]);
  };

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
          {draft.map((list, index) => {
            const key = itemKey(list);
            const name = list.map((tag) => tag.name).join(' + ');
            return (
              <Paper key={key} component="li" withBorder p="xs" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    {index + 1}. {itemLabel(list)}
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
                      onClick={() => setDraft(draft.filter((other) => itemKey(other) !== key))}
                    >
                      <XIcon size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Paper>
            );
          })}
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
          onChange={(value) => append([value as string])}
          searchable
          maw={320}
        />
      ) : (
        <Text size="sm" c="dimmed">
          {t('setup.mainTags.noMoreTags')}
        </Text>
      )}

      <CombinationAdder
        tags={tags}
        isListed={(tagIds) =>
          draft.some((list) =>
            sameTagSet(
              list.map((tag) => tag.id),
              tagIds,
            ),
          )
        }
        onAdd={append}
      />

      <Group>
        <Button
          onClick={() => onSave(draft.map((list) => ({ tagIds: list.map((tag) => tag.id) })))}
          disabled={!dirty}
          loading={saving}
        >
          {t('setup.mainTags.save')}
        </Button>
      </Group>
    </Stack>
  );
}
