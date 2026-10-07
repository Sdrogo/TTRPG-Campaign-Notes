import { useState } from 'react';
import { ActionIcon, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { CheckIcon, PencilSimpleIcon, StackIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tag } from '../../types/tag';
import { CompactListItem } from '../CompactList';

interface TagRowProps {
  tag: Tag;
  /** Whether the Tag is a Main Tag or part of a combination. */
  inGrouping: boolean;
  /** Whether the row shows the rename field instead of the name. */
  editing: boolean;
  /** The last rename's error, shown under the field. */
  error: string | null;
  saving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  /** Saves this (trimmed, non-empty, changed) name. */
  onRename: (name: string) => void;
  onDelete: () => void;
}

/**
 * One Tag in the setup's All Tags list (spec 25c): `#Name`, its category
 * dimmed, a marker when the Grouping uses it, then Rename and Delete. Rename
 * turns the row into a field, prefilled and selected: Enter or the check
 * saves, Esc or the X cancels, and a refused name shows under the field.
 */
export function TagRow({
  tag,
  inGrouping,
  editing,
  error,
  saving,
  onStartEdit,
  onCancelEdit,
  onRename,
  onDelete,
}: TagRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(tag.name);
  const trimmed = draft.trim();

  /** Saves a real change; the same name just closes the field. */
  const submit = () => {
    if (!trimmed) return;
    if (trimmed === tag.name) onCancelEdit();
    else onRename(trimmed);
  };

  if (editing) {
    return (
      <CompactListItem
        actionsAtEnd
        actions={
          <>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t('setup.tags.all.saveRename')}
              onClick={submit}
              loading={saving}
              disabled={!trimmed}
            >
              <CheckIcon size={14} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              aria-label={t('setup.tags.all.cancelRename')}
              onClick={onCancelEdit}
            >
              <XIcon size={14} />
            </ActionIcon>
          </>
        }
      >
        <TextInput
          size="xs"
          py={2}
          aria-label={t('setup.tags.all.renameInput', { name: tag.name })}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') onCancelEdit();
          }}
          error={error}
          autoFocus
          data-autofocus
        />
      </CompactListItem>
    );
  }

  return (
    <CompactListItem
      actionsAtEnd
      actions={
        <>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={t('setup.tags.all.rename', { name: tag.name })}
            onClick={onStartEdit}
          >
            <PencilSimpleIcon size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label={t('setup.tags.delete', { name: tag.name })}
            onClick={onDelete}
          >
            <TrashIcon size={14} />
          </ActionIcon>
        </>
      }
    >
      <Group gap={6} wrap="nowrap">
        <Text size="sm" fw={500} truncate="end" title={tag.name}>
          #{tag.name}
        </Text>
        {tag.category && (
          <Text size="xs" c="dimmed" truncate="end" style={{ flexShrink: 1 }}>
            {tag.category}
          </Text>
        )}
        {inGrouping && (
          <Tooltip label={t('setup.tags.all.inGrouping')}>
            <StackIcon
              size={14}
              color="var(--text-muted)"
              aria-label={t('setup.tags.all.inGrouping')}
              role="img"
              style={{ flexShrink: 0 }}
            />
          </Tooltip>
        )}
      </Group>
    </CompactListItem>
  );
}
