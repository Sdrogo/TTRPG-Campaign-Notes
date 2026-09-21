import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Stack, Group, Title, Button, SimpleGrid, Text, Loader, Switch } from '@mantine/core';
import { PlusIcon, ArrowLeftIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { useRoom, useUpdateRoomSettings } from '../hooks/useRooms';
import { DocumentCard } from '../components/DocumentCard';
import { CreateDocumentModal } from '../components/CreateDocumentModal';

export function RoomDocumentsPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
        <Loader color="accent" />
      </Stack>
    );
  }

  if (!session) {
    return (
      <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
        <Text>Accedi per vedere i Documenti di questa Stanza.</Text>
        <Button component={Link} to="/">
          Vai al login
        </Button>
      </Stack>
    );
  }

  return <RoomDocumentsContent roomId={roomId} currentUserId={session.user.id} />;
}

function RoomDocumentsContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const [createOpened, setCreateOpened] = useState(false);
  const room = useRoom(roomId, true);
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);
  const updateSettings = useUpdateRoomSettings(roomId);

  const isMaster = members.data?.find((m) => m.userId === currentUserId)?.role === 'master';

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button component={Link} to="/" variant="subtle" leftSection={<ArrowLeftIcon size={16} />}>
          Le mie Stanze
        </Button>
      </Group>

      <Group justify="space-between">
        <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
          Documenti{room.data ? ` — ${room.data.name}` : ''}
        </Title>
        <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreateOpened(true)}>
          Crea Documento
        </Button>
      </Group>

      {isMaster && room.data && (
        <Switch
          label="I Player possono creare Documenti"
          checked={room.data.playersCanCreateDocuments}
          onChange={(event) => updateSettings.mutate(event.currentTarget.checked)}
        />
      )}

      {documents.isLoading && <Loader color="accent" />}
      {documents.isError && <Text c="red">Errore nel caricamento dei Documenti.</Text>}
      {documents.data && documents.data.length === 0 && (
        <Text c="dimmed">Nessun Documento ancora. Creane uno per iniziare.</Text>
      )}
      {documents.data && documents.data.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {documents.data.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              roomId={roomId}
              tags={tags.data ?? []}
            />
          ))}
        </SimpleGrid>
      )}

      <CreateDocumentModal
        opened={createOpened}
        onClose={() => setCreateOpened(false)}
        roomId={roomId}
      />
    </Stack>
  );
}
