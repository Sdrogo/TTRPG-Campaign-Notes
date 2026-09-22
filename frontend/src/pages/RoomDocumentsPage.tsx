import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Group, Title, Button, SimpleGrid, Text, Loader, Switch } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { useRoom, useUpdateRoomSettings } from '../hooks/useRooms';
import { DocumentCard } from '../components/DocumentCard';
import { CreateDocumentModal } from '../components/CreateDocumentModal';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';

export function RoomDocumentsPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>Accedi per vedere i Documenti di questa Stanza.</SignInRequired>;
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
  // D-13/FR-D7: same rule the backend enforces, so a Player isn't offered a
  // form that would only be rejected on submit.
  const canCreateDocument = isMaster || room.data?.playersCanCreateDocuments === true;

  return (
    <PageLayout backTo="/" backLabel="Le mie Stanze">
      <Group justify="space-between">
        <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
          Documenti{room.data ? ` — ${room.data.name}` : ''}
        </Title>
        {canCreateDocument && (
          <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreateOpened(true)}>
            Crea Documento
          </Button>
        )}
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
              members={members.data ?? []}
            />
          ))}
        </SimpleGrid>
      )}

      <CreateDocumentModal
        opened={createOpened}
        onClose={() => setCreateOpened(false)}
        roomId={roomId}
      />
    </PageLayout>
  );
}
