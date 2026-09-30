import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMembers } from '../hooks/useMembers';
import { useSetMainTags, useTags } from '../hooks/useTags';
import { notifyError, notifySuccess } from '../lib/notify';
import { sortMainTags } from '../lib/tags';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { MainTagsEditor } from '../components/setup/MainTagsEditor';
import { MemberManagement } from '../components/setup/MemberManagement';

/**
 * `/rooms/:roomId/setup` (spec 11): the Room's setup, reachable only by an
 * Administrator of that Room - everyone else gets a message instead (the
 * backend enforces the same on every write). Holds the member management that
 * used to be its own page, and the Main Tags that order the Documents page.
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
  const setMainTags = useSetMainTags(roomId ?? '');

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

  /** Saves the Main Tags and confirms or reports the result. */
  const handleSaveMainTags = (tagIds: string[]) => {
    setMainTags.mutate(tagIds, {
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

      {tags.isLoading && <Loader color="accent" />}
      {tags.isError && <Text c="red">{t('setup.loadError')}</Text>}
      {tags.data && (
        <MainTagsEditor
          // Re-keyed on the saved order so a save, or a change made
          // elsewhere, replaces the draft instead of fighting it.
          key={sortMainTags(tags.data)
            .map((tag) => tag.id)
            .join()}
          tags={tags.data}
          saving={setMainTags.isPending}
          onSave={handleSaveMainTags}
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
