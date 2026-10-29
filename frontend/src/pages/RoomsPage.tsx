import { useState } from 'react';
import { Container, Stack, Group, Title, Button, SimpleGrid, Text, Loader } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useMyRooms } from '../hooks/useRooms';
import { RoomCard } from '../components/RoomCard';
import { CreateRoomModal } from '../components/CreateRoomModal';
import { useTranslation } from 'react-i18next';

interface RoomsPageProps {
  /** The signed-in user, passed down so each Room card can offer Leave. */
  currentUserId: string;
}

// Columns by the width the grid actually has (spec 51), so a card stays
// between about 300px and 480px wide however wide the screen.
const ROOM_COLUMNS = { base: 1, '640px': 2, '1040px': 3, '1440px': 4, '1840px': 5, '2240px': 6 };

/** The signed-in user's Rooms, with a button to create one. Shown by `MyRoomsPage` at `/rooms`. */
export function RoomsPage({ currentUserId }: RoomsPageProps) {
  const { t } = useTranslation();
  const [createOpened, setCreateOpened] = useState(false);
  const myRooms = useMyRooms(true);

  return (
    // w: inside MyRoomsPage's column Stack, the Container's auto margins
    // would otherwise shrink it to its content in the middle of the page.
    <Container component="main" fluid w="100%" px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="lg">
      <Stack gap="xl">
      <Group justify="space-between" align="flex-end" className="rooms-heading">
        <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
          {t('common.myRooms')}
        </Title>
        <Button leftSection={<PlusIcon size={18} />} onClick={() => setCreateOpened(true)}>
          {t('rooms.create')}
        </Button>
      </Group>

      {myRooms.isLoading && <Loader color="accent" />}
      {myRooms.isError && <Text c="red">{t('rooms.loadError')}</Text>}
      {myRooms.data && myRooms.data.length === 0 && (
        <Text c="dimmed">{t('rooms.empty')}</Text>
      )}
      {myRooms.data && myRooms.data.length > 0 && (
        <SimpleGrid type="container" cols={ROOM_COLUMNS} spacing="lg">
          {myRooms.data.map((myRoom) => (
            <RoomCard key={myRoom.room.id} myRoom={myRoom} currentUserId={currentUserId} />
          ))}
        </SimpleGrid>
      )}

      <CreateRoomModal opened={createOpened} onClose={() => setCreateOpened(false)} />
      </Stack>
    </Container>
  );
}
