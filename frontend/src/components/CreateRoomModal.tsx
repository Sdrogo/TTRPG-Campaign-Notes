import { useState } from 'react';
import { Modal, Stack, TextInput, Button, Text, FileButton, Group } from '@mantine/core';
import { TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useCreateRoom, useUploadNewRoomImage } from '../hooks/useRooms';
import { ACCEPTED_IMAGE_TYPES } from '../lib/images';
import { notifyError } from '../lib/notify';
import { RoomImage } from './RoomImage';
import { useTranslation } from 'react-i18next';

interface CreateRoomModalProps {
  opened: boolean;
  onClose: () => void;
}

/**
 * Creates a Room from a name, an optional game system and an optional image
 * (spec 26, the PDF's default cover). The creator becomes its Master and
 * Administrator. The image is uploaded once the Room exists; if that fails the
 * Room is kept and a toast says the image can be set from the setup page.
 */
export function CreateRoomModal({ opened, onClose }: CreateRoomModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  // The picked image with its local preview, revoked when replaced or dropped.
  const [image, setImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const createRoom = useCreateRoom();
  const uploadImage = useUploadNewRoomImage();

  const pickImage = (file: File | null) => {
    if (image) {
      URL.revokeObjectURL(image.previewUrl);
    }
    setImage(file ? { file, previewUrl: URL.createObjectURL(file) } : null);
  };

  const handleClose = () => {
    setName('');
    setGameSystem('');
    pickImage(null);
    createRoom.reset();
    uploadImage.reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    createRoom.mutate(
      { name, gameSystem },
      {
        onSuccess: (room) => {
          if (!image) {
            handleClose();
            return;
          }
          uploadImage.mutate(
            { roomId: room.id, file: image.file },
            {
              onError: (error) =>
                notifyError(t('rooms.createModal.imageFailed', { reason: error.message })),
              onSettled: handleClose,
            },
          );
        },
      },
    );
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={t('rooms.createModal.title')} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label={t('common.name')}
            placeholder={t('rooms.createModal.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            autoFocus
          />
          <TextInput
            label={t('rooms.createModal.gameSystem')}
            placeholder={t('rooms.createModal.gameSystemPlaceholder')}
            value={gameSystem}
            onChange={(event) => setGameSystem(event.currentTarget.value)}
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t('rooms.createModal.image')}
            </Text>
            <Group gap="md" align="flex-end" wrap="nowrap">
              <RoomImage url={image?.previewUrl ?? null} width={80} />
              <Stack gap="xs">
                <Group gap="xs">
                  <FileButton onChange={pickImage} accept={ACCEPTED_IMAGE_TYPES}>
                    {(props) => (
                      <Button
                        {...props}
                        variant="light"
                        size="xs"
                        leftSection={<UploadSimpleIcon size={16} />}
                      >
                        {image
                          ? t('rooms.createModal.changeImage')
                          : t('rooms.createModal.chooseImage')}
                      </Button>
                    )}
                  </FileButton>
                  {image && (
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      onClick={() => pickImage(null)}
                      leftSection={<TrashIcon size={16} />}
                    >
                      {t('common.remove')}
                    </Button>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {t('rooms.createModal.imageHint')}
                </Text>
              </Stack>
            </Group>
          </Stack>
          {createRoom.isError && (
            <Text c="red" size="sm">
              {String(createRoom.error)}
            </Text>
          )}
          <Button
            type="submit"
            loading={createRoom.isPending || uploadImage.isPending}
            disabled={!name.trim()}
          >
            {t('rooms.create')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
