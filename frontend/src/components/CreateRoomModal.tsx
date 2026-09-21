import { useState } from 'react';
import { Modal, Stack, TextInput, Button, Text } from '@mantine/core';
import { useCreateRoom } from '../hooks/useRooms';

interface CreateRoomModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CreateRoomModal({ opened, onClose }: CreateRoomModalProps) {
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
    <Modal opened={opened} onClose={handleClose} title="Crea una Stanza" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Nome"
            placeholder="Es. La Maledizione di Strahd"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            autoFocus
          />
          <TextInput
            label="Sistema di gioco"
            placeholder="Es. D&D 5e (opzionale)"
            value={gameSystem}
            onChange={(event) => setGameSystem(event.currentTarget.value)}
          />
          {createRoom.isError && (
            <Text c="red" size="sm">
              {String(createRoom.error)}
            </Text>
          )}
          <Button type="submit" loading={createRoom.isPending} disabled={!name.trim()}>
            Crea Stanza
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
