import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useLandingEvents, useRoomSections } from '../hooks/useLanding';
import { useMembers } from '../hooks/useMembers';
import { useRoom } from '../hooks/useRooms';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { RoomTitleActions } from '../components/RoomTitleActions';
import { RoomPdfExports } from '../components/pdf/RoomPdfExports';
import { LandingCard } from '../components/landing/LandingCard';
import { LandingEditor } from '../components/landing/LandingEditor';
import { EditModeButton } from '../components/landing/EditModeButton';
import { canCreateDocuments } from '../lib/roomPermissions';
import { sectionHref } from '../lib/landing';
import { sectionDescription, sectionTitle } from '../lib/landingText';
import { useBackState } from '../lib/backNav';

/**
 * `/rooms/:roomId`: the Room's landing page (spec 55), what a Room card
 * opens. The Room's name as the heading, then its Section cards in the
 * Master's order: the page cards (Documents, Maps, Session 0) and the
 * custom Sections. The Master edits it in place (`LandingEditor`).
 */
export function RoomLandingPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading } = useSession();

  if (!roomId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('documents.signInRequired')}</SignInRequired>;
  return <RoomLandingContent roomId={roomId} currentUserId={session.user.id} />;
}

function RoomLandingContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backState = useBackState();
  const room = useRoom(roomId, true);
  const sections = useRoomSections(roomId);
  const members = useMembers(roomId, true);
  const readOnly = useReadOnly();
  useLandingEvents(roomId);
  const me = members.data?.find((member) => member.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  const canEdit = isMaster && Boolean(sections.data?.[0]?.canEdit);
  const [editing, setEditing] = useState(false);

  return (
    <PageLayout backTo="/rooms" backLabel={t('common.myRooms')} roomId={roomId} showIndex>
      <Group justify="space-between" align="flex-end" wrap="nowrap" className="documents-page-heading">
        <Stack gap={2} style={{ minWidth: 0 }}>
          {room.data && (
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} className="documents-kicker">
              {t('roomLanding.kicker')}
            </Text>
          )}
          <Group gap="sm" wrap="nowrap">
            <Title order={1} className="documents-page-title" style={{ fontFamily: 'var(--font-display)' }}>
              {room.data ? room.data.name : t('roomLanding.home')}
            </Title>
            {canEdit && <EditModeButton editing={editing} onChange={setEditing} />}
          </Group>
        </Stack>
        {room.data && me && !readOnly && (
          <RoomTitleActions
            roomId={roomId}
            roomName={room.data.name}
            isAdmin={me.isAdmin}
            isMaster={isMaster}
            canImport={canCreateDocuments(me, room.data)}
            currentUserId={currentUserId}
            onLeft={() => navigate('/rooms')}
            viewAsMembers={isMaster ? members.data!.filter((m) => m.userId !== currentUserId) : undefined}
          />
        )}
      </Group>
      {!readOnly && <RoomPdfExports roomId={roomId} userId={currentUserId} />}
      {sections.isPending && <Loader color="accent" />}
      {sections.isError && <Text c="red">{t('roomLanding.loadError')}</Text>}
      {sections.data &&
        (canEdit && editing ? (
          <LandingEditor roomId={roomId} sections={sections.data} />
        ) : (
          <Box className="documents-grid">
            {sections.data.map((section) => (
              <LandingCard
                key={section.id}
                to={sectionHref(roomId, section)}
                state={backState}
                title={sectionTitle(section)}
                description={sectionDescription(section)}
                imageUrl={section.imageUrl}
                headingOrder={2}
              />
            ))}
          </Box>
        ))}
    </PageLayout>
  );
}
