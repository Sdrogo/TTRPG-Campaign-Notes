import { Stack, Text } from '@mantine/core';
import { ArrowDownIcon, ArrowUpIcon, MapTrifoldIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { itemKey, resolveMainItems } from '../../lib/mainItems';
import { moveItem } from '../../lib/mainTags';
import type { MainItem, Tag } from '../../types/tag';
import { CompactList, CompactListItem } from '../CompactList';
import { GroupAdder } from './GroupAdder';
import { LabeledActionIcon } from '../LabeledActionIcon';

interface GroupingEditorProps {
  /** Every Tag of the Room, to resolve the items' names from. */
  tags: Tag[];
  /** The Main items in their order, as saved (or being saved). */
  items: MainItem[];
  /** Saves the Main items as this whole list (the backend replaces it at once). */
  onChange: (items: MainItem[]) => void;
  /** How many items the Documents page shows before the maps row (0 = above them all). */
  mapsPosition: number;
  /** Saves the maps row's new place. */
  onMapsPositionChange: (position: number) => void;
}

/** A row of the list: a Main item, or the Room page's maps row placed among them. */
type Entry = { kind: 'item'; tags: Tag[] } | { kind: 'maps' };

/**
 * The Grouping part of the setup's Tags section (specs 11, 11_2, 25c): the
 * Main items the Documents page groups by, in order, each a single Tag or a
 * combination. Moving, removing or adding an item saves the whole list at once
 * (no "Save order" button, 25c Decision 3). The items hold Tag ids and take the
 * names from `tags`, so a renamed Tag shows its new name here straight away.
 * The Room page's maps row sits among them as one more entry, moved like
 * them but never removed (Andrea, 2026-10-25); it shows only once there is
 * an item to place it against.
 */
export function GroupingEditor({
  tags,
  items,
  onChange,
  mapsPosition,
  onMapsPositionChange,
}: GroupingEditorProps) {
  const { t } = useTranslation();
  const resolved = resolveMainItems(items, tags);
  // Saved as resolved: an item whose Tag is gone is dropped, not sent back.
  const listed = resolved.map((list) => list.map((tag) => tag.id));
  const save = (lists: Tag[][]) =>
    onChange(lists.map((list) => ({ tagIds: list.map((tag) => tag.id) })));
  // Past the last item (some were removed elsewhere) it shows after them all.
  const mapsAt = Math.min(Math.max(mapsPosition, 0), resolved.length);
  const entries: Entry[] = resolved.map((list) => ({ kind: 'item', tags: list }));
  entries.splice(mapsAt, 0, { kind: 'maps' });
  const mapsName = t('setup.tags.grouping.mapsRow');

  // Moving an entry swaps it with its neighbour: the items' order and the maps
  // row's place are read back from the new list, and only what changed is saved.
  const move = (index: number, offset: number) => {
    const next = moveItem(entries, index, offset);
    const nextItems = next.flatMap((entry) => (entry.kind === 'item' ? [entry.tags] : []));
    const nextMapsAt = next.findIndex((entry) => entry.kind === 'maps');
    if (nextItems.some((list, position) => itemKey(list) !== itemKey(resolved[position]))) {
      save(nextItems);
    }
    if (nextMapsAt !== mapsAt) onMapsPositionChange(nextMapsAt);
  };
  const remove = (itemIndex: number) => {
    save(resolved.filter((_, position) => position !== itemIndex));
    // The maps row keeps its neighbours: one item fewer before it.
    if (itemIndex < mapsAt) onMapsPositionChange(mapsAt - 1);
  };

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
          {entries.map((entry, index) => {
            const moveActions = (name: string) => (
              <>
                <LabeledActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={t('setup.tags.grouping.moveUp', { name })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon size={14} />
                </LabeledActionIcon>
                <LabeledActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={t('setup.tags.grouping.moveDown', { name })}
                  disabled={index === entries.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon size={14} />
                </LabeledActionIcon>
              </>
            );
            if (entry.kind === 'maps') {
              return (
                <CompactListItem
                  key="maps"
                  actionsAtEnd
                  leading={
                    <Text c="dimmed" w={18} style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                      <MapTrifoldIcon size={14} aria-hidden="true" />
                    </Text>
                  }
                  actions={
                    <>
                      {moveActions(mapsName)}
                      {/* Never removed: keeps the actions aligned with the items'. */}
                      <span style={{ width: 22, flexShrink: 0 }} aria-hidden="true" />
                    </>
                  }
                >
                  <Text size="sm" fw={500} c="dimmed" fs="italic" truncate="end">
                    {mapsName}
                  </Text>
                </CompactListItem>
              );
            }
            const list = entry.tags;
            const itemIndex = index > mapsAt ? index - 1 : index;
            const key = itemKey(list);
            const name = list.map((tag) => tag.name).join(' + ');
            return (
              <CompactListItem
                key={key}
                actionsAtEnd
                leading={
                  <Text size="xs" c="dimmed" w={18} ta="right" style={{ flexShrink: 0 }}>
                    {itemIndex + 1}.
                  </Text>
                }
                actions={
                  <>
                    {moveActions(name)}
                    <LabeledActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label={t('setup.tags.grouping.remove', { name })}
                      onClick={() => remove(itemIndex)}
                    >
                      <XIcon size={14} />
                    </LabeledActionIcon>
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
