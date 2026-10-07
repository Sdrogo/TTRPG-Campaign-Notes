import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useCreateTag, useDeleteTag, useRenameTag } from '../../hooks/useTags';
import { normalizeForSearch } from '../../lib/documentMentions';
import { notifyError, notifySuccess } from '../../lib/notify';
import { sortTagsByName } from '../../lib/tags';
import type { Tag } from '../../types/tag';
import { CompactList } from '../CompactList';
import { TagRow } from './TagRow';

interface AllTagsListProps {
  roomId: string;
  /** Every Tag of the Room. */
  tags: Tag[];
  /** The ids of the Tags the Grouping uses, alone or in a combination. */
  groupedIds: Set<string>;
}

/** The message of a failed request, to show under the field that sent it. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The All Tags part of the setup's Tags section (specs 13, 25c): a filter
 * (case- and accent-insensitive, like the mention popup), a field that
 * creates a Tag, and every Tag in alphabetical order, in columns on wide
 * screens. A Tag can be renamed in place (one row at a time) or deleted after
 * a confirmation, which names no Document count: the backend has none that
 * respects visibility (VR-07).
 */
export function AllTagsList({ roomId, tags, groupedIds }: AllTagsListProps) {
  const { t } = useTranslation();
  const createTag = useCreateTag(roomId);
  const renameTag = useRenameTag(roomId);
  const deleteTag = useDeleteTag(roomId);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pending, setPending] = useState<Tag | null>(null);

  const query = normalizeForSearch(filter.trim());
  const shown = sortTagsByName(tags).filter((tag) => normalizeForSearch(tag.name).includes(query));

  /** Creates the typed Tag; a refused name stays in the field with the reason. */
  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createTag.mutate(
      { name },
      {
        onSuccess: (tag) => {
          notifySuccess(t('setup.tags.all.created', { name: tag.name }));
          setNewName('');
          setCreateError(null);
        },
        onError: (error) => setCreateError(messageOf(error)),
      },
    );
  };

  /** Opens the rename field on one row, closing any other. */
  const startEdit = (tagId: string | null) => {
    setEditingId(tagId);
    setRenameError(null);
  };

  const handleRename = (tag: Tag, name: string) => {
    renameTag.mutate(
      { tagId: tag.id, name },
      {
        onSuccess: (renamed) => {
          notifySuccess(t('setup.tags.all.renamed', { name: renamed.name }));
          startEdit(null);
        },
        onError: (error) => setRenameError(messageOf(error)),
      },
    );
  };

  const handleDelete = (tag: Tag) => {
    deleteTag.mutate(tag.id, {
      onSuccess: () => {
        notifySuccess(t('setup.tags.deleted', { name: tag.name }));
        setPending(null);
      },
      onError: notifyError,
    });
  };

  return (
    <Stack gap="sm">
      <Group gap="xs" align="flex-start" wrap="wrap">
        <TextInput
          size="sm"
          aria-label={t('setup.tags.all.filterLabel')}
          placeholder={t('setup.tags.all.filterPlaceholder')}
          leftSection={<MagnifyingGlassIcon size={14} />}
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          style={{ flex: '1 1 200px', maxWidth: 320 }}
        />
        <TextInput
          size="sm"
          aria-label={t('setup.tags.all.newLabel')}
          placeholder={t('setup.tags.all.newPlaceholder')}
          value={newName}
          onChange={(event) => {
            setNewName(event.currentTarget.value);
            setCreateError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate();
          }}
          error={createError}
          rightSection={
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t('setup.tags.all.create')}
              onClick={handleCreate}
              loading={createTag.isPending}
              disabled={!newName.trim()}
            >
              <PlusIcon size={14} />
            </ActionIcon>
          }
          style={{ flex: '1 1 200px', maxWidth: 320 }}
        />
      </Group>

      {tags.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('setup.tags.all.empty')}
        </Text>
      ) : shown.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('setup.tags.all.noMatch', { query: filter.trim() })}
        </Text>
      ) : (
        <CompactList columnWidth={240}>
          {shown.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              inGrouping={groupedIds.has(tag.id)}
              editing={editingId === tag.id}
              error={editingId === tag.id ? renameError : null}
              saving={renameTag.isPending}
              onStartEdit={() => startEdit(tag.id)}
              onCancelEdit={() => startEdit(null)}
              onRename={(name) => handleRename(tag, name)}
              onDelete={() => setPending(tag)}
            />
          ))}
        </CompactList>
      )}

      {pending && (
        <Modal
          opened
          onClose={() => setPending(null)}
          title={t('setup.tags.confirmTitle', { name: pending.name })}
          centered
        >
          <Stack gap="md">
            <Text size="sm">{t('setup.tags.confirmBody')}</Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                loading={deleteTag.isPending}
                onClick={() => handleDelete(pending)}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
