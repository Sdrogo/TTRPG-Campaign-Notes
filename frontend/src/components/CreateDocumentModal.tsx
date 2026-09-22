import { useState } from 'react';
import { Modal, Stack, Group, TextInput, Button, Text } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useCreateDocument } from '../hooks/useDocuments';
import { useTags, useCreateTag } from '../hooks/useTags';
import { DocumentFields } from './DocumentFields';
import type { DocumentFormValues } from '../types/document';

interface CreateDocumentModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

const EMPTY_VALUES: DocumentFormValues = {
  name: '',
  description: '',
  visibility: 'room',
  tagIds: [],
};

export function CreateDocumentModal({ opened, onClose, roomId }: CreateDocumentModalProps) {
  const [values, setValues] = useState<DocumentFormValues>(EMPTY_VALUES);
  const [newTagName, setNewTagName] = useState('');

  const tags = useTags(roomId, opened);
  const createTag = useCreateTag(roomId);
  const createDocument = useCreateDocument(roomId);

  const handleClose = () => {
    setValues(EMPTY_VALUES);
    setNewTagName('');
    createDocument.reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // A tag still being created is added to `values` only once it exists;
    // submitting now would silently drop it.
    if (createTag.isPending) return;
    createDocument.mutate(values, { onSuccess: handleClose });
  };

  const handleAddTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    createTag.mutate(
      { name: trimmed },
      {
        onSuccess: (tag) => {
          setValues((current) => ({ ...current, tagIds: [...current.tagIds, tag.id] }));
          setNewTagName('');
        },
      },
    );
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Crea Documento" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <DocumentFields values={values} onChange={setValues} tags={tags.data ?? []} autoFocus />
          <Group gap="xs" align="flex-end">
            <TextInput
              label="Nuovo tag"
              placeholder="Es. Fazione"
              value={newTagName}
              onChange={(event) => setNewTagName(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              variant="light"
              leftSection={<PlusIcon size={16} />}
              onClick={handleAddTag}
              loading={createTag.isPending}
              disabled={!newTagName.trim()}
            >
              Aggiungi
            </Button>
          </Group>
          {createDocument.isError && (
            <Text c="red" size="sm">
              {String(createDocument.error)}
            </Text>
          )}
          <Button
            type="submit"
            loading={createDocument.isPending}
            disabled={!values.name.trim() || createTag.isPending}
          >
            Crea Documento
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
