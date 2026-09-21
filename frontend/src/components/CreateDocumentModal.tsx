import { useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  TextInput,
  Textarea,
  Select,
  MultiSelect,
  Button,
  Text,
} from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useCreateDocument } from '../hooks/useDocuments';
import { useTags, useCreateTag } from '../hooks/useTags';
import type { DocumentVisibility } from '../types/document';

interface CreateDocumentModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

const VISIBILITY_OPTIONS = [
  { value: 'room', label: 'Stanza (tutti i membri)' },
  { value: 'master', label: 'Solo Master' },
  { value: 'private', label: 'Privato (Owner + Master)' },
  { value: 'selective', label: 'Selettivo (solo Owner + Master finché non scegli altri)' },
];

export function CreateDocumentModal({ opened, onClose, roomId }: CreateDocumentModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<DocumentVisibility>('room');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');

  const tags = useTags(roomId, opened);
  const createTag = useCreateTag(roomId);
  const createDocument = useCreateDocument(roomId);

  const handleClose = () => {
    setName('');
    setDescription('');
    setVisibility('room');
    setTagIds([]);
    setNewTagName('');
    createDocument.reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    createDocument.mutate({ name, description, visibility, tagIds }, { onSuccess: handleClose });
  };

  const handleAddTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    createTag.mutate(
      { name: trimmed },
      {
        onSuccess: (tag) => {
          setTagIds((current) => [...current, tag.id]);
          setNewTagName('');
        },
      },
    );
  };

  const tagOptions = (tags.data ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <Modal opened={opened} onClose={handleClose} title="Crea Documento" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Nome"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            autoFocus
          />
          <Textarea
            label="Descrizione"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            minRows={3}
            autosize
          />
          <Select
            label="Visibilità"
            data={VISIBILITY_OPTIONS}
            value={visibility}
            onChange={(value) => setVisibility((value as DocumentVisibility | null) ?? 'room')}
            allowDeselect={false}
          />
          <MultiSelect
            label="Tag"
            data={tagOptions}
            value={tagIds}
            onChange={setTagIds}
            searchable
          />
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
          <Button type="submit" loading={createDocument.isPending} disabled={!name.trim()}>
            Crea Documento
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
