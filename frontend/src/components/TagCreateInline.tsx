import { useState } from 'react';
import { Button, Group, TextInput } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useCreateTag } from '../hooks/useTags';
import type { Tag } from '../types/tag';

interface TagCreateInlineProps {
  roomId: string;
  onCreated: (tag: Tag) => void;
  /** Reports whether a creation is in flight, so the caller can hold off
   *  submitting its own form until the new Tag's id has landed. */
  onPendingChange?: (pending: boolean) => void;
}

/**
 * A small "new Tag" field and button, used wherever a Document's Tags are
 * edited (`DocumentFields`) so a missing Tag doesn't need a trip to the Room's
 * Tag settings - originally built only into `CreateDocumentModal`, extended to
 * edit mode by spec `10 - UX Refinment`.
 */
export function TagCreateInline({ roomId, onCreated, onPendingChange }: TagCreateInlineProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const createTag = useCreateTag(roomId);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onPendingChange?.(true);
    createTag.mutate(
      { name: trimmed },
      {
        onSuccess: (tag) => {
          onCreated(tag);
          setName('');
        },
        onSettled: () => onPendingChange?.(false),
      },
    );
  };

  return (
    <Group gap="xs" align="flex-end">
      <TextInput
        label={t('documents.fields.newTag')}
        placeholder={t('documents.fields.newTagPlaceholder')}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        style={{ flex: 1 }}
      />
      <Button
        variant="light"
        leftSection={<PlusIcon size={16} />}
        onClick={handleAdd}
        loading={createTag.isPending}
        disabled={!name.trim()}
      >
        {t('common.add')}
      </Button>
    </Group>
  );
}
