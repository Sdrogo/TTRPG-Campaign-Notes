import { ActionIcon, Stack, Text } from '@mantine/core';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { itemKey, resolveMainItems } from '../../lib/mainItems';
import { moveItem } from '../../lib/mainTags';
import type { MainItem, Tag } from '../../types/tag';
import { CompactList, CompactListItem } from '../CompactList';
import { GroupAdder } from './GroupAdder';

interface GroupingEditorProps {
  /** Every Tag of the Room, to resolve the items' names from. */
  tags: Tag[];
  /** The Main items in their order, as saved (or being saved). */
  items: MainItem[];
  /** Saves the Main items as this whole list (the backend replaces it at once). */
  onChange: (items: MainItem[]) => void;
}

/**
 * The Grouping part of the setup's Tags section (specs 11, 11_2, 25c): the
 * Main items the Documents page groups by, in order, each a single Tag or a
 * combination. Moving, removing or adding an item saves the whole list at once
 * (no "Save order" button, 25c Decision 3). The items hold Tag ids and take the
 * names from `tags`, so a renamed Tag shows its new name here straight away.
 */
export function GroupingEditor({ tags, items, onChange }: GroupingEditorProps) {
  const { t } = useTranslation();
  const resolved = resolveMainItems(items, tags);
  // Saved as resolved: an item whose Tag is gone is dropped, not sent back.
  const listed = resolved.map((list) => list.map((tag) => tag.id));
  const save = (lists: Tag[][]) =>
    onChange(lists.map((list) => ({ tagIds: list.map((tag) => tag.id) })));

  // No wider than a form field (spec 25 Decision 5), so on a very wide
  // screen the actions stay near the names.
  return (
    <Stack gap="sm" maw={640}>
      {resolved.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('setup.tags.grouping.empty')}
        </Text>
      ) : (
        <CompactList component="ol">
          {resolved.map((list, index) => {
            const key = itemKey(list);
            const name = list.map((tag) => tag.name).join(' + ');
            return (
              <CompactListItem
                key={key}
                actionsAtEnd
                leading={
                  <Text size="xs" c="dimmed" w={18} ta="right" style={{ flexShrink: 0 }}>
                    {index + 1}.
                  </Text>
                }
                actions={
                  <>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={t('setup.tags.grouping.moveUp', { name })}
                      disabled={index === 0}
                      onClick={() => save(moveItem(resolved, index, -1))}
                    >
                      <ArrowUpIcon size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={t('setup.tags.grouping.moveDown', { name })}
                      disabled={index === resolved.length - 1}
                      onClick={() => save(moveItem(resolved, index, 1))}
                    >
                      <ArrowDownIcon size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label={t('setup.tags.grouping.remove', { name })}
                      onClick={() => save(resolved.filter((other) => itemKey(other) !== key))}
                    >
                      <XIcon size={14} />
                    </ActionIcon>
                  </>
                }
              >
                <Text size="sm" fw={500} truncate="end" title={name}>
                  {list.map((tag, position) => (
                    <span key={tag.id}>
                      {position > 0 && (
                        <Text span c="dimmed" fw={400}>
                          {' + '}
                        </Text>
                      )}
                      #{tag.name}
                    </span>
                  ))}
                </Text>
              </CompactListItem>
            );
          })}
        </CompactList>
      )}

      <GroupAdder
        tags={tags}
        listed={listed}
        onAdd={(tagIds) => onChange([...listed, tagIds].map((ids) => ({ tagIds: ids })))}
      />
    </Stack>
  );
}
