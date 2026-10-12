import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionIcon, Button, Group, Modal, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { GearIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useDeleteMap, useMap, useMapLabels, useSaveBoard, useUpdateMap } from '../hooks/useMaps';
import { useMembers } from '../hooks/useMembers';
import { useTags } from '../hooks/useTags';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { MapBoard } from '../components/maps/MapBoard';
import { MapFormModal } from '../components/maps/MapFormModal';
import type { Board, RelationshipMapDetail } from '../types/map';

/** How long the board waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** Mantine's `sm` breakpoint: below it a map is read-only (Decision 13). */
const WIDE_ENOUGH = '(min-width: 48em)';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * `/rooms/:roomId/maps/:mapId`: one relationship map, full page (spec 28).
 * Its creator and the Master edit it on a screen at least `sm` wide; the
 * board saves itself shortly after each change and says so.
 */
export function RelationshipMapPage() {
  const { t } = useTranslation();
  const { roomId, mapId } = useParams<{ roomId: string; mapId: string }>();
  const { session, loading } = useSession();

  if (!roomId || !mapId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('maps.signInRequired')}</SignInRequired>;
  return <MapContent roomId={roomId} mapId={mapId} currentUserId={session.user.id} />;
}

function MapContent({
  roomId,
  mapId,
  currentUserId,
}: {
  roomId: string;
  mapId: string;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const map = useMap(roomId, mapId, true);

  if (map.isPending) return <FullPageLoader />;
  if (map.isError) {
    return (
      <FullPageMessage actionLabel={t('maps.backToMaps')} actionTo={`/rooms/${roomId}/maps`}>
        {t('maps.notFound')}
      </FullPageMessage>
    );
  }
  return <MapEditor key={map.data.id} roomId={roomId} map={map.data} currentUserId={currentUserId} />;
}

function MapEditor({
  roomId,
  map,
  currentUserId,
}: {
  roomId: string;
  map: RelationshipMapDetail;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const wide = useMediaQuery(WIDE_ENOUGH, true);
  const members = useMembers(roomId, true);
  const me = members.data?.find((member) => member.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  const editable = map.canEdit && !readOnly && wide;

  const documents = useDocuments(roomId, editable);
  const tags = useTags(roomId, editable);
  const labels = useMapLabels(roomId, editable);
  const saveBoard = useSaveBoard(roomId, map.id);
  const updateMap = useUpdateMap(roomId, map.id);
  const deleteMap = useDeleteMap(roomId, map.id);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [deleteOpened, setDeleteOpened] = useState(false);

  // The page draws its own copy of the board, from the first load on.
  const [board, setBoard] = useState<Board>(() => ({
    groups: map.groups,
    cards: map.cards,
    arrows: map.arrows,
  }));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (next: Board) => {
    setSaveState('saving');
    saveBoard.mutate(next, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('error'),
    });
  };

  const handleChange = (next: Board) => {
    setBoard(next);
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
  };

  const status: Record<SaveState, string | null> = {
    idle: null,
    pending: t('maps.unsaved'),
    saving: t('maps.saving'),
    saved: t('maps.saved'),
    error: saveBoard.error?.message ?? t('maps.saveError'),
  };

  return (
    <PageLayout backTo={`/rooms/${roomId}/maps`} backLabel={t('maps.backToMaps')} roomId={roomId}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Group gap="sm" wrap="wrap">
            <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
              {map.name}
            </Title>
            <VisibilityBadge visibility={map.visibility} />
          </Group>
          {map.description && (
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-line' }}>
              {map.description}
            </Text>
          )}
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {status[saveState] && (
            <Text size="sm" c={saveState === 'error' ? 'red' : 'dimmed'} role="status">
              {status[saveState]}
            </Text>
          )}
          {saveState === 'error' && (
            <Button size="xs" variant="light" onClick={() => save(board)}>
              {t('maps.retry')}
            </Button>
          )}
          {map.canEdit && !readOnly && (
            <>
              <Tooltip label={t('maps.settings')} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label={t('maps.settings')}
                  onClick={() => setSettingsOpened(true)}
                >
                  <GearIcon size={20} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('maps.delete')} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="lg"
                  aria-label={t('maps.delete')}
                  onClick={() => setDeleteOpened(true)}
                >
                  <TrashIcon size={20} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
      </Group>
      {map.canEdit && !readOnly && !wide && (
        <Text size="sm" c="dimmed">
          {t('maps.readOnlyOnPhone')}
        </Text>
      )}
      <MapBoard
        roomId={roomId}
        board={board}
        editable={editable}
        isMaster={isMaster}
        documents={documents.data ?? []}
        tags={tags.data ?? []}
        labels={labels.data ?? []}
        onChange={handleChange}
      />
      {settingsOpened && (
        <MapFormModal
          title={t('maps.settings')}
          initialValues={{
            name: map.name,
            description: map.description,
            visibility: map.visibility,
            selectiveUserIds: map.selectiveUserIds ?? [],
          }}
          members={members.data ?? []}
          creatorId={map.createdBy}
          submitLabel={t('common.save')}
          submitting={updateMap.isPending}
          error={updateMap.error?.message ?? null}
          onClose={() => {
            updateMap.reset();
            setSettingsOpened(false);
          }}
          onSubmit={(values) => updateMap.mutate(values, { onSuccess: () => setSettingsOpened(false) })}
        />
      )}
      <Modal
        opened={deleteOpened}
        onClose={() => setDeleteOpened(false)}
        title={t('maps.deleteConfirmTitle')}
        centered
      >
        <Stack gap="sm">
          <Text>{t('maps.deleteConfirmBody', { name: map.name })}</Text>
          {deleteMap.error && <Text c="red">{deleteMap.error.message}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleteMap.isPending}
              onClick={() =>
                deleteMap.mutate(undefined, {
                  onSuccess: () => void navigate(`/rooms/${roomId}/maps`),
                })
              }
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageLayout>
  );
}
