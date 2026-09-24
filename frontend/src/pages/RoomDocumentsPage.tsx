import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { TagFilter } from '../components/TagFilter';
import { filterDocumentsByTags } from '../lib/documentFilters';
import { canCreateDocuments } from '../lib/roomPermissions';
import { useTranslation } from 'react-i18next';

/**
 * `/rooms/:roomId/documents`: the Documents the viewer can see, filterable by
 * Tags through `?tag=` (FR-N2). The Master also gets the switch for Players'
 * Document creation (D-13).
 */
export function RoomDocumentsPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('documents.signInRequired')}</SignInRequired>;
  }

  return <RoomDocumentsContent roomId={roomId} currentUserId={session.user.id} />;
}

function RoomDocumentsContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const [createOpened, setCreateOpened] = useState(false);
  const room = useRoom(roomId, true);
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);
  const updateSettings = useUpdateRoomSettings(roomId);
  // `?tag=…` (repeatable): where a `#Tag` mention leads. Tags combine (AND).
  const [searchParams, setSearchParams] = useSearchParams();
  const tagFilter = searchParams.getAll('tag');
  const setTagFilter = (tagIds: string[]) =>
    setSearchParams(new URLSearchParams(tagIds.map((id) => ['tag', id])), { replace: true });

  const me = members.data?.find((m) => m.userId === currentUserId);
  const isMaster = me?.role === 'master';
  // D-13/FR-D7: same rule the backend enforces, so a Player isn't offered a
  // form that would only be rejected on submit.
  const canCreateDocument = canCreateDocuments(me, room.data);
  const shown = documents.data ? filterDocumentsByTags(documents.data, tagFilter) : undefined;

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')}>
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        <Group justify="space-between">
          <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
            {room.data ? t('documents.titleWithRoom', { room: room.data.name }) : t('documents.title')}
          </Title>
          {canCreateDocument && (
            <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreateOpened(true)}>
              {t('documents.create')}
            </Button>
          )}
        </Group>

        {isMaster && room.data && (
          <Switch
            label={t('documents.playersCanCreate')}
            checked={room.data.playersCanCreateDocuments}
            onChange={(event) => updateSettings.mutate(event.currentTarget.checked)}
          />
        )}

        {documents.data && documents.data.length > 0 && (
          <TagFilter
            tags={tags.data ?? []}
            value={tagFilter}
            onChange={setTagFilter}
            maw={{ base: '100%', sm: 480 }}
          />
        )}

        {documents.isLoading && <Loader color="accent" />}
        {documents.isError && <Text c="red">{t('documents.loadError')}</Text>}
        {documents.data && documents.data.length === 0 && (
          <Text c="dimmed">{t('documents.empty')}</Text>
        )}
        {documents.data && documents.data.length > 0 && shown && shown.length === 0 && (
          <Group gap="xs">
            <Text c="dimmed">{t('documents.noMatchForTags', { count: tagFilter.length })}</Text>
            <Button size="xs" variant="subtle" onClick={() => setTagFilter([])}>
              {t('documents.showAll')}
            </Button>
          </Group>
        )}
        {shown && shown.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {shown.map((document) => (
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
      </DocumentMentionsProvider>
    </PageLayout>
  );
}
