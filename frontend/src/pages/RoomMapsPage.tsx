import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
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
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { MapFormModal } from '../components/maps/MapFormModal';
import { MapImportModal } from '../components/maps/MapImportModal';
import { canCreateDocuments } from '../lib/roomPermissions';
import { formatRelativeTime } from '../lib/time';
import { useBackState } from '../lib/backNav';

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
    <PageLayout backTo={`/rooms/${roomId}/documents`} backLabel={t('maps.backToDocuments')} roomId={roomId}>
      <Group justify="space-between" align="flex-end" wrap="wrap" className="maps-page-heading">
        <Stack gap={2}>
          {room.data && (
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} className="maps-page-kicker">
              {room.data.name}
            </Text>
          )}
          <Title order={1} className="maps-page-title" style={{ fontFamily: 'var(--font-display)' }}>
            {t('maps.title')}
          </Title>
        </Stack>
        {canCreate && (
          <Group gap="xs" wrap="wrap" justify="flex-end" className="maps-page-actions">
            <Button variant="default" leftSection={<FileArrowUpIcon size={16} />} onClick={() => setImporting(true)}>
              {t('maps.import.button')}
            </Button>
            <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreating(true)}>
              {t('maps.create')}
            </Button>
          </Group>
        )}
      </Group>
      {maps.isPending && <Loader />}
      {maps.isError && <Text c="red">{t('maps.loadError')}</Text>}
      {maps.data?.length === 0 && (
        <Card withBorder radius="md" p="xl" className="maps-empty-state">
          <Stack align="center" gap="md">
            <ThemeIcon variant="light" color="gray" size="xl" radius="md" aria-hidden="true">
              <MapTrifoldIcon size={28} weight="duotone" />
            </ThemeIcon>
            <Text c="dimmed" ta="center">
              {t('maps.empty')}
            </Text>
          </Stack>
        </Card>
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
                <ArrowUpRightIcon size={18} aria-hidden="true" />
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
