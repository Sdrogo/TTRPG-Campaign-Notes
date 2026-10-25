import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { FileArrowUpIcon, PlusIcon } from '@phosphor-icons/react';
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
      <Group justify="space-between" wrap="nowrap">
        <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
          {t('maps.title')}
        </Title>
        {canCreate && (
          <Group gap="xs" wrap="nowrap">
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
      {maps.data?.length === 0 && <Text c="dimmed">{t('maps.empty')}</Text>}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {maps.data?.map((map) => (
          <Card
            key={map.id}
            component={Link}
            to={`/rooms/${roomId}/maps/${map.id}`}
            withBorder
            radius="md"
            p="md"
          >
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
                  {map.name}
                </Title>
                <Group gap={4} wrap="nowrap">
                  {map.kind === 'geographic' && (
                    <Badge variant="light" color="gray">
                      {t('maps.kind.geographicBadge')}
                    </Badge>
                  )}
                  <VisibilityBadge visibility={map.visibility} />
                </Group>
              </Group>
              {map.description && (
                <Text size="sm" c="dimmed" lineClamp={3} style={{ whiteSpace: 'pre-line' }}>
                  {map.description}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {t('maps.documentCount', { count: map.documentCount })} ·{' '}
                {t('maps.lastEdit', { when: formatRelativeTime(map.updatedAt) })}
              </Text>
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
