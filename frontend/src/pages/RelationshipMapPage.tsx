import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionIcon, Button, Group, Modal, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { DownloadSimpleIcon, GearIcon, MapTrifoldIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useDeleteMap, useMap, useSaveBoard, useUpdateMap } from '../hooks/useMaps';
import { useExportMap, useGeoMap, useSaveGeo } from '../hooks/useGeoMap';
import { useMembers } from '../hooks/useMembers';
import { useTags } from '../hooks/useTags';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { MapBoard } from '../components/maps/MapBoard';
import { SplitToggle } from '../components/maps/SplitToggle';
import { useSideDocument } from '../hooks/useSideDocument';
import { MapFormModal } from '../components/maps/MapFormModal';
import { GeographicBoard } from '../components/maps/GeographicBoard';
import { GeoMapDialog } from '../components/maps/GeoMapDialog';
import type { GeoBoard, GeoMapDetail } from '../types/geoMap';
import type { Board, RelationshipMap, RelationshipMapDetail } from '../types/map';
import { notifyError } from '../lib/notify';

/** How long the board waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** Mantine's `sm` breakpoint: below it a map is read-only (Decision 13). */
const WIDE_ENOUGH = '(min-width: 48em)';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * `/rooms/:roomId/maps/:mapId`: one map, full page: a free board (spec 28)
 * or a geographic map (spec 38). Its creator and the Master edit it on a
 * screen at least `sm` wide; it saves itself shortly after each change and
 * says so.
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
  const geographic = map.data?.kind === 'geographic';
  const geo = useGeoMap(roomId, mapId, geographic);

  if (map.isPending || (geographic && geo.isPending)) return <FullPageLoader />;
  if (map.isError || (geographic && geo.isError)) {
    return (
      <FullPageMessage actionLabel={t('maps.backToMaps')} actionTo={`/rooms/${roomId}/maps`}>
        {t('maps.notFound')}
      </FullPageMessage>
    );
  }
  if (geographic) {
    return <GeoMapEditor key={map.data.id} roomId={roomId} map={geo.data!} currentUserId={currentUserId} />;
  }
  return <MapEditor key={map.data.id} roomId={roomId} map={map.data} currentUserId={currentUserId} />;
}

/**
 * The page's own copy of what is drawn, saved `SAVE_DELAY_MS` after the last
 * change: a save landing mid-drag moves nothing back.
 */
function useAutosave<T>(initial: T, saver: UseMutationResult<unknown, Error, T>) {
  const [value, setValue] = useState<T>(initial);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (next: T) => {
    setSaveState('saving');
    saver.mutate(next, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('error'),
    });
  };

  const change = (next: T) => {
    setValue(next);
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
  };

  return { value, saveState, change, retry: () => save(value), error: saver.error };
}

/** Who looks at the map, and whether they may change it here. */
function useMapAccess(roomId: string, map: RelationshipMap, currentUserId: string) {
  const readOnly = useReadOnly();
  const wide = useMediaQuery(WIDE_ENOUGH, true);
  const split = useSideDocument();
  const members = useMembers(roomId, true);
  const me = members.data?.find((member) => member.userId === currentUserId);
  return {
    readOnly,
    wide,
    split,
    members,
    // While the split is open, a click on a Document shows it there (spec 37).
    splitOpen: split.sideId !== null && wide,
    isMaster: me?.role === 'master' && !readOnly,
    editable: map.canEdit && !readOnly && wide,
  };
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
  const access = useMapAccess(roomId, map, currentUserId);
  const documents = useDocuments(roomId, access.editable);
  const tags = useTags(roomId, access.editable);
  const autosave = useAutosave<Board>(
    { groups: map.groups, cards: map.cards, arrows: map.arrows },
    useSaveBoard(roomId, map.id),
  );

  return (
    <MapChrome roomId={roomId} map={map} access={access} autosave={autosave}>
      <MapBoard
        roomId={roomId}
        board={autosave.value}
        editable={access.editable}
        isMaster={access.isMaster}
        documents={documents.data ?? []}
        tags={tags.data ?? []}
        onChange={autosave.change}
        onSelectDocument={access.splitOpen ? access.split.open : undefined}
      />
    </MapChrome>
  );
}

/** A geographic map (spec 38): its plane, and a "Map" dialog for its size and background. */
function GeoMapEditor({
  roomId,
  map,
  currentUserId,
}: {
  roomId: string;
  map: GeoMapDetail;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const access = useMapAccess(roomId, map, currentUserId);
  const documents = useDocuments(roomId, access.editable);
  // The Tag filter is for everyone who sees the map (Decision 8).
  const tags = useTags(roomId, true);
  const autosave = useAutosave<GeoBoard>(
    { areas: map.areas, pins: map.pins, links: map.links },
    useSaveGeo(roomId, map.id),
  );
  const [planeOpened, setPlaneOpened] = useState(false);
  const exportMap = useExportMap(roomId, map.id, map.name);

  return (
    <MapChrome
      roomId={roomId}
      map={map}
      access={access}
      autosave={autosave}
      actions={
        <>
          <Tooltip label={t('maps.geo.export')} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={t('maps.geo.export')}
              loading={exportMap.isPending}
              onClick={() => exportMap.mutate(undefined, { onError: (error) => notifyError(error) })}
            >
              <DownloadSimpleIcon size={20} />
            </ActionIcon>
          </Tooltip>
          {map.canEdit && !access.readOnly && (
            <Tooltip label={t('maps.geo.planeTitle')} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t('maps.geo.planeTitle')}
                onClick={() => setPlaneOpened(true)}
              >
                <MapTrifoldIcon size={20} />
              </ActionIcon>
            </Tooltip>
          )}
        </>
      }
    >
      <GeographicBoard
        roomId={roomId}
        board={autosave.value}
        planeWidth={map.planeWidth}
        planeHeight={map.planeHeight}
        backgroundUrl={map.backgroundUrl}
        editable={access.editable}
        isMaster={access.isMaster}
        documents={documents.data ?? []}
        tags={tags.data ?? []}
        onChange={autosave.change}
        onSelectDocument={access.splitOpen ? access.split.open : undefined}
      />
      {planeOpened && <GeoMapDialog roomId={roomId} map={map} onClose={() => setPlaneOpened(false)} />}
    </MapChrome>
  );
}

/**
 * What every map page has around its board: the name, description and
 * visibility, the save status, the split toggle, and for whoever manages the
 * map its settings and its deletion.
 */
function MapChrome({
  roomId,
  map,
  access,
  autosave,
  actions,
  children,
}: {
  roomId: string;
  map: RelationshipMap;
  access: ReturnType<typeof useMapAccess>;
  autosave: { saveState: SaveState; retry: () => void; error: Error | null };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { readOnly, wide, members } = access;
  const updateMap = useUpdateMap(roomId, map.id);
  const deleteMap = useDeleteMap(roomId, map.id);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [deleteOpened, setDeleteOpened] = useState(false);
  const { saveState } = autosave;

  const status: Record<SaveState, string | null> = {
    idle: null,
    pending: t('maps.unsaved'),
    saving: t('maps.saving'),
    saved: t('maps.saved'),
    error: autosave.error?.message || t('maps.saveError'),
  };

  return (
    <PageLayout allowEmptySide backTo={`/rooms/${roomId}/maps`} backLabel={t('maps.backToMaps')} roomId={roomId}>
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
            <Button size="xs" variant="light" onClick={autosave.retry}>
              {t('maps.retry')}
            </Button>
          )}
          <SplitToggle />
          {actions}
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
      {children}
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
