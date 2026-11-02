import { useState } from 'react';
import { Container, Stack, Button, SimpleGrid, Text } from '@mantine/core';
import { DoorOpenIcon, PlusIcon } from '@phosphor-icons/react';
import { useMyRooms } from '../hooks/useRooms';
import { RoomCard } from '../components/RoomCard';
import { CreateRoomModal } from '../components/CreateRoomModal';
import { useTranslation } from 'react-i18next';
import { PageHeading } from '../components/PageHeading';
import { EmptyState } from '../components/EmptyState';
import { SectionLoader } from '../components/PageState';

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
      <PageHeading
        title={t('common.myRooms')}
        actions={
          <Button leftSection={<PlusIcon size={18} />} onClick={() => setCreateOpened(true)}>
            {t('rooms.create')}
          </Button>
        }
      />

      {myRooms.isLoading && <SectionLoader />}
      {myRooms.isError && <Text c="red">{t('rooms.loadError')}</Text>}
      {myRooms.data && myRooms.data.length === 0 && (
        <EmptyState icon={<DoorOpenIcon size={28} weight="duotone" />}>{t('rooms.empty')}</EmptyState>
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
