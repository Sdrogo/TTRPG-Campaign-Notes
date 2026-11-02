import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  ArrowUpRightIcon,
  FileArrowUpIcon,
  GraphIcon,
  MapTrifoldIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useCreateMap, useMaps } from '../hooks/useMaps';
import { useMembers } from '../hooks/useMembers';
import { useRoom } from '../hooks/useRooms';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SignInRequired, SectionLoader } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { MapFormModal } from '../components/maps/MapFormModal';
import { MapImportModal } from '../components/maps/MapImportModal';
import { canCreateDocuments } from '../lib/roomPermissions';
import { formatRelativeTime } from '../lib/time';
import { useBackState } from '../lib/backNav';
import { PageHeading } from '../components/PageHeading';
import { EmptyState } from '../components/EmptyState';

/**
 * `/rooms/:roomId/maps`: the Room's relationship maps the viewer sees (spec 28
 * Decision 1), each with its description, how many Documents it shows them
 * and when it was last edited, and the dialog that creates one.
 */
export function RoomMapsPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading } = useSession();

  if (!roomId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('maps.signInRequired')}</SignInRequired>;
  return <RoomMapsContent roomId={roomId} currentUserId={session.user.id} />;
}

function RoomMapsContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const backState = useBackState();
  const navigate = useNavigate();
  const room = useRoom(roomId, true);
  const maps = useMaps(roomId, true);
  const members = useMembers(roomId, true);
  const createMap = useCreateMap(roomId);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const readOnly = useReadOnly();
  const me = members.data?.find((member) => member.userId === currentUserId);
  // Decision 2: the same rule as for Documents (D-13).
  const canCreate = canCreateDocuments(me, room.data) && !readOnly;
  // `?new=1`: "New map" on the Room's page when it has none opens the dialog
  // here; closing it drops the parameter.
  const [searchParams, setSearchParams] = useSearchParams();
  const showCreate = creating || (searchParams.get('new') === '1' && canCreate);
  const closeCreate = () => {
    setCreating(false);
    if (searchParams.has('new')) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <PageLayout
      backTo={`/rooms/${roomId}`}
      backLabel={t('roomLanding.home')}
      roomId={roomId}
      showIndex
      index={{ current: 'page_maps' }}
    >
      <PageHeading
        kicker={room.data?.name}
        title={t('maps.title')}
        actions={
          canCreate && (
            <>
              <Button variant="default" leftSection={<FileArrowUpIcon size={18} />} onClick={() => setImporting(true)}>
                {t('maps.import.button')}
              </Button>
              <Button leftSection={<PlusIcon size={18} />} onClick={() => setCreating(true)}>
                {t('maps.create')}
              </Button>
            </>
          )
        }
      />
      {maps.isPending && <SectionLoader />}
      {maps.isError && <Text c="red">{t('maps.loadError')}</Text>}
      {maps.data?.length === 0 && (
        <EmptyState icon={<MapTrifoldIcon size={28} weight="duotone" />}>{t('maps.empty')}</EmptyState>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="lg" className="maps-page-grid">
        {maps.data?.map((map, index) => (
          <Card
            key={map.id}
            component={Link}
            to={`/rooms/${roomId}/maps/${map.id}`}
            state={backState}
            withBorder
            radius="md"
            p={0}
            className="maps-page-card"
            data-kind={map.kind}
          >
            <Box className="maps-page-card-visual" aria-hidden="true">
              <Text className="maps-page-card-index">
                {String(index + 1).padStart(2, '0')}
              </Text>
              <ThemeIcon variant="transparent" color="gray" size={64}>
                {map.kind === 'geographic' ? (
                  <MapTrifoldIcon size={48} weight="duotone" />
                ) : (
                  <GraphIcon size={48} weight="duotone" />
                )}
              </ThemeIcon>
            </Box>
            <Stack gap="md" p="lg" className="maps-page-card-body">
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
                    {map.name}
                  </Title>
                  <VisibilityBadge visibility={map.visibility} />
                </Group>
                <Badge variant="light" color="gray" w="fit-content">
                  {t(
                    map.kind === 'geographic'
                      ? 'maps.kind.geographicBadge'
                      : 'maps.kind.free',
                  )}
                </Badge>
              </Stack>
              <Box className="maps-page-card-description">
                {map.description ? (
                  <Text size="sm" c="dimmed" lineClamp={3} style={{ whiteSpace: 'pre-line' }}>
                    {map.description}
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed" fs="italic">
                    {t('common.noDescription')}
                  </Text>
                )}
              </Box>
              <Group justify="space-between" gap="md" wrap="nowrap" className="maps-page-card-footer">
                <Text size="xs" c="dimmed">
                  {t('maps.documentCount', { count: map.documentCount })} ·{' '}
                  {t('maps.lastEdit', { when: formatRelativeTime(map.updatedAt) })}
                </Text>
                <ArrowUpRightIcon size={20} aria-hidden="true" />
              </Group>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {showCreate && (
        <MapFormModal
          title={t('maps.create')}
          initialValues={{
            name: '',
            description: '',
            visibility: room.data?.defaultVisibility ?? 'room',
            selectiveUserIds: [],
            kind: 'free',
          }}
          kindChoice
          // `showCreate` needs `me`, so the members have loaded.
          members={members.data!}
          creatorId={currentUserId}
          submitLabel={t('maps.create')}
          submitting={createMap.isPending}
          error={createMap.error?.message ?? null}
          onClose={() => {
            createMap.reset();
            closeCreate();
          }}
          onSubmit={(values) =>
            createMap.mutate(values, {
              onSuccess: (created) => void navigate(`/rooms/${roomId}/maps/${created.id}`),
            })
          }
        />
      )}
      {importing && (
        <MapImportModal
          roomId={roomId}
          // `importing` needs `me`, so the members have loaded.
          members={members.data!}
          creatorId={currentUserId}
          defaultVisibility={room.data?.defaultVisibility ?? 'room'}
          onClose={() => setImporting(false)}
          onImported={(created) => void navigate(`/rooms/${roomId}/maps/${created.id}`)}
        />
      )}
    </PageLayout>
  );
}
