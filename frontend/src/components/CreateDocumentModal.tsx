import { useState } from 'react';
import { Modal, Stack, Button, Text } from '@mantine/core';
import { useCreateDocument } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { DocumentFields } from './DocumentFields';
import type { DocumentFormValues } from '../types/document';
import { useTranslation } from 'react-i18next';

interface CreateDocumentModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  /** Whether the viewer may add a Tag inline (Administrator or Master). */
  canManageTags: boolean;
}

const EMPTY_VALUES: DocumentFormValues = {
  name: '',
  description: '',
  visibility: 'room',
  tagIds: [],
};

/**
 * Creates a Document in the Room, with a shortcut for adding a new Tag without
 * leaving the form. Clears itself on close.
 */
export function CreateDocumentModal({ opened, onClose, roomId, canManageTags }: CreateDocumentModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<DocumentFormValues>(EMPTY_VALUES);
  const [tagCreatePending, setTagCreatePending] = useState(false);

  const tags = useTags(roomId, opened);
  const createDocument = useCreateDocument(roomId);

  const handleClose = () => {
    setValues(EMPTY_VALUES);
    setTagCreatePending(false);
    createDocument.reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // A tag still being created is added to `values` only once it exists;
    // submitting now would silently drop it.
    if (tagCreatePending) return;
    createDocument.mutate(values, { onSuccess: handleClose });
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={t('documents.create')} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <DocumentFields
            values={values}
            onChange={setValues}
            tags={tags.data ?? []}
            roomId={roomId}
            canCreateTag={canManageTags}
            onTagCreatePendingChange={setTagCreatePending}
            autoFocus
          />
          {createDocument.isError && (
            <Text c="red" size="sm">
              {String(createDocument.error)}
            </Text>
          )}
          <Button
            type="submit"
            loading={createDocument.isPending}
            disabled={!values.name.trim() || tagCreatePending}
          >
            {t('documents.create')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
