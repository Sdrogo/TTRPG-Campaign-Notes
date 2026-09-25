import { useState } from 'react';
import { Modal, Stack, TextInput, Button, Text } from '@mantine/core';
import { useCreateRoom } from '../hooks/useRooms';
import { useTranslation } from 'react-i18next';

interface CreateRoomModalProps {
  opened: boolean;
  onClose: () => void;
}

/**
 * Creates a Room from a name and an optional game system. The creator becomes
 * its Master and Administrator.
 */
export function CreateRoomModal({ opened, onClose }: CreateRoomModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  const createRoom = useCreateRoom();

  const handleClose = () => {
    setName('');
    setGameSystem('');
    createRoom.reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    createRoom.mutate(
      { name, gameSystem },
      {
        onSuccess: handleClose,
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
          {createRoom.isError && (
            <Text c="red" size="sm">
              {String(createRoom.error)}
            </Text>
          )}
          <Button type="submit" loading={createRoom.isPending} disabled={!name.trim()}>
            {t('rooms.create')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
