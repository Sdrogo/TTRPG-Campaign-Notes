import { useState } from 'react';
import { Stack, Group, Title, Button, SimpleGrid, Text, Loader } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useMyRooms } from '../hooks/useRooms';
import { RoomCard } from '../components/RoomCard';
import { CreateRoomModal } from '../components/CreateRoomModal';

/** The signed-in user's Rooms, with a button to create one. Shown by `HomePage`. */
export function RoomsPage() {
  const [createOpened, setCreateOpened] = useState(false);
  const myRooms = useMyRooms(true);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
          Le mie Stanze
        </Title>
        <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreateOpened(true)}>
          Crea Stanza
        </Button>
      </Group>

      {myRooms.isLoading && <Loader color="accent" />}
      {myRooms.isError && <Text c="red">Errore nel caricamento delle Stanze.</Text>}
      {myRooms.data && myRooms.data.length === 0 && (
        <Text c="dimmed">Nessuna Stanza ancora. Creane una per iniziare.</Text>
      )}
      {myRooms.data && myRooms.data.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {myRooms.data.map((myRoom) => (
            <RoomCard key={myRoom.room.id} myRoom={myRoom} />
          ))}
        </SimpleGrid>
      )}

      <CreateRoomModal opened={createOpened} onClose={() => setCreateOpened(false)} />
    </Stack>
  );
}
