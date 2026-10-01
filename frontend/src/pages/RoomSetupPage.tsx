import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMembers } from '../hooks/useMembers';
import { useMainItems, useSetMainItems } from '../hooks/useMainItems';
import { useTags } from '../hooks/useTags';
import { useRoom } from '../hooks/useRooms';
import { notifyError, notifySuccess } from '../lib/notify';
import { itemKey, resolveMainItems } from '../lib/mainItems';
import type { MainItem } from '../types/tag';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { MainTagsEditor } from '../components/setup/MainTagsEditor';
import { MemberManagement } from '../components/setup/MemberManagement';
import { TagManagement } from '../components/setup/TagManagement';
import { DeleteRoomSection } from '../components/setup/DeleteRoomSection';

/**
 * `/rooms/:roomId/setup` (spec 11): the Room's setup, reachable only by an
 * Administrator of that Room - everyone else gets a message instead (the
 * backend enforces the same on every write). Holds the member management that
 * used to be its own page, the Main Tags that order the Documents page, the
 * Tag list with its delete buttons and the Room's deletion (spec 13).
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
  const tags = useTags(roomId ?? '', isAdmin);
  const mainItems = useMainItems(roomId ?? '', isAdmin);
  const setMainItems = useSetMainItems(roomId ?? '');
  const room = useRoom(roomId ?? '', isAdmin);

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

  if (!isAdmin) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/">
        {t('setup.adminOnly')}
      </FullPageMessage>
    );
  }

  /** Saves the Main items and confirms or reports the result. */
  const handleSaveMainItems = (items: MainItem[]) => {
    setMainItems.mutate(items, {
      onSuccess: () => notifySuccess(t('setup.mainTags.saved')),
      onError: notifyError,
    });
  };

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')} roomId={roomId}>
      <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.title')}
      </Title>

      <Stack gap="sm">
        <Title order={3} style={{ fontFamily: 'var(--font-display)' }}>
          {t('members.title')}
        </Title>
        <MemberManagement
          roomId={roomId}
          members={members.data}
          currentUserId={session.user.id}
          onLeft={() => navigate('/')}
        />
      </Stack>

      {(tags.isLoading || mainItems.isLoading) && <Loader color="accent" />}
      {(tags.isError || mainItems.isError) && <Text c="red">{t('setup.loadError')}</Text>}
      {tags.data && mainItems.data && (
        <MainTagsEditor
          // Re-keyed on the saved list and on the Room's Tags so a save,
          // a change made elsewhere or a deleted Tag (spec 13) replaces the
          // draft instead of fighting it or keeping a Tag that is gone.
          key={`${tags.data.map((tag) => tag.id).join(',')}#${resolveMainItems(
            mainItems.data,
            tags.data,
          )
            .map(itemKey)
            .join('|')}`}
          tags={tags.data}
          items={mainItems.data}
          saving={setMainItems.isPending}
          onSave={handleSaveMainItems}
        />
      )}

      {tags.data && <TagManagement roomId={roomId} tags={tags.data} />}

      {room.data && (
        <DeleteRoomSection
          roomId={roomId}
          roomName={room.data.name}
          onDeleted={() => navigate('/')}
        />
      )}
    </PageLayout>
  );
}

/** Keeps old `/rooms/:roomId/members` links working now that setup replaced that page. */
export function RoomMembersRedirect() {
  const { roomId } = useParams<{ roomId: string }>();
  return <Navigate to={`/rooms/${roomId}/setup`} replace />;
}
