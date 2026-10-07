import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMembers } from '../hooks/useMembers';
import { useMainItems } from '../hooks/useMainItems';
import { useTags } from '../hooks/useTags';
import { useRoom } from '../hooks/useRooms';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { ExportRoomModal } from '../components/ExportRoomModal';
import { PageLayout } from '../components/PageLayout';
import { MemberManagement } from '../components/setup/MemberManagement';
import { TagsSection } from '../components/setup/TagsSection';
import { DeleteRoomSection } from '../components/setup/DeleteRoomSection';
import { DefaultVisibilitySection } from '../components/setup/DefaultVisibilitySection';
import { RoomImageSection } from '../components/setup/RoomImageSection';
import { VisibilityHistory } from '../components/setup/VisibilityHistory';

/**
 * `/rooms/:roomId/setup` (spec 11): the Room's setup, reachable only by an
 * Administrator or the Master of that Room - everyone else gets a message
 * instead (the backend enforces the same on every write). Two tabs: Settings,
 * for Administrators only, holds the member management that used to be its
 * own page, the Room's image (spec 26), its default visibility (spec 22), the one Tags section
 * (spec 25c: the Grouping that orders the Documents page and every Tag, to
 * create, rename and delete) and the Room's deletion (spec 13); History, for both, the visibility history (spec 22).
 */
export function RoomSetupPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();
  const signedIn = Boolean(session) && Boolean(roomId);
  const members = useMembers(roomId ?? '', signedIn);
  const currentMember = members.data?.find((m) => m.userId === session?.user.id);
  const isAdmin = currentMember?.isAdmin ?? false;
  const isMaster = currentMember?.role === 'master';
  const tags = useTags(roomId ?? '', isAdmin);
  const mainItems = useMainItems(roomId ?? '', isAdmin);
  const room = useRoom(roomId ?? '', isAdmin);
  const [exportOpened, setExportOpened] = useState(false);

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('setup.signInRequired')}</SignInRequired>;
  }

  if (members.isError) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/">
        {t('setup.loadError')}
      </FullPageMessage>
    );
  }

  if (!members.data) {
    return <FullPageLoader />;
  }

  if (!isAdmin && !isMaster) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/">
        {t('setup.adminOnly')}
      </FullPageMessage>
    );
  }

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')} roomId={roomId}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
          {t('setup.title')}
        </Title>
        <Button
          variant="light"
          leftSection={<DownloadSimpleIcon size={16} />}
          onClick={() => setExportOpened(true)}
        >
          {t('export.action')}
        </Button>
      </Group>
      <ExportRoomModal
        opened={exportOpened}
        onClose={() => setExportOpened(false)}
        roomId={roomId}
      />

      <Tabs defaultValue={isAdmin ? 'settings' : 'history'} keepMounted={false}>
        <Tabs.List mb="lg">
          {isAdmin && <Tabs.Tab value="settings">{t('setup.tabs.settings')}</Tabs.Tab>}
          <Tabs.Tab value="history">{t('setup.tabs.history')}</Tabs.Tab>
        </Tabs.List>
        {isAdmin && (
          <Tabs.Panel value="settings">
            <Stack gap="md">
              <Stack gap="sm">
                <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
                  {t('members.title')}
                </Title>
                <MemberManagement
                  roomId={roomId}
                  members={members.data}
                  currentUserId={session.user.id}
                  onLeft={() => navigate('/')}
                />
              </Stack>

              {room.data && <RoomImageSection roomId={roomId} imageUrl={room.data.imageUrl} />}

              {room.data && (
                <DefaultVisibilitySection roomId={roomId} value={room.data.defaultVisibility} />
              )}

              {(tags.isLoading || mainItems.isLoading) && <Loader color="accent" />}
              {(tags.isError || mainItems.isError) && <Text c="red">{t('setup.loadError')}</Text>}
              {tags.data && mainItems.data && (
                <TagsSection roomId={roomId} tags={tags.data} items={mainItems.data} />
              )}

              {room.data && (
                <DeleteRoomSection
                  roomId={roomId}
                  roomName={room.data.name}
                  onDeleted={() => navigate('/')}
                />
              )}
            </Stack>
          </Tabs.Panel>
        )}
        <Tabs.Panel value="history">
          <VisibilityHistory roomId={roomId} members={members.data} />
        </Tabs.Panel>
      </Tabs>
    </PageLayout>
  );
}

/** Keeps old `/rooms/:roomId/members` links working now that setup replaced that page. */
export function RoomMembersRedirect() {
  const { roomId } = useParams<{ roomId: string }>();
  return <Navigate to={`/rooms/${roomId}/setup`} replace />;
}
