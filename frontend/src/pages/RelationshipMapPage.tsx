import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Box, Button, Group, Menu, Modal, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  GearIcon,
  MapTrifoldIcon,
  SquareSplitHorizontalIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useDeleteMap, useMap, useSaveBoard, useUpdateMap } from '../hooks/useMaps';
import { useExportMap, useGeoMap, useSaveGeo } from '../hooks/useGeoMap';
import { useMapEvents } from '../hooks/useMapEvents';
import { useMembers } from '../hooks/useMembers';
import { useTags } from '../hooks/useTags';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { LabeledActionIcon } from '../components/LabeledActionIcon';
import { MapBoard } from '../components/maps/MapBoard';
import { parsePlaceSide, placeSide, useSideDocument } from '../hooks/useSideDocument';
import { MapFormModal } from '../components/maps/MapFormModal';
import { GeographicBoard } from '../components/maps/GeographicBoard';
import { GeoMapDialog } from '../components/maps/GeoMapDialog';
import { PlaceSidePane } from '../components/maps/PlaceSidePane';
import type { GeoBoard, GeoMapDetail } from '../types/geoMap';
import type { Board, RelationshipMap, RelationshipMapDetail } from '../types/map';
import { toBoardBody } from '../lib/maps';
import { placeOfDocument, toGeoBody, type GeoItemRef } from '../lib/geoMaps';
import { notifyError } from '../lib/notify';
import { ApiError } from '../lib/apiClient';
import { useBoardAutosave, type SaveState } from '../hooks/useBoardAutosave';

export { SAVE_DELAY_MS } from '../hooks/useBoardAutosave';

/** Mantine's `sm` breakpoint: below it a map is read-only (Decision 13). */
const WIDE_ENOUGH = '(min-width: 48em)';

/**
 * `/rooms/:roomId/maps/:mapId`: one map, full page: a free board (spec 28)
 * or a geographic map (spec 38). Its creator and the Master edit it on a
 * screen at least `sm` wide, and so does every member who sees it once it is
 * unlocked (spec 42); it saves itself shortly after each change and says so.
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

/** Whether a read failed because the map is gone or now hidden from the viewer. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
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
  // Read again on the Room stream's events (spec 52), every few seconds
  // while it is down: a free map's board comes with the map, a geographic
  // map's content from `.../geo`.
  const live = useMapEvents(roomId, mapId);
  const map = useMap(roomId, mapId, true, live.fallback);
  const geographic = map.data?.kind === 'geographic';
  const geo = useGeoMap(roomId, mapId, geographic, live.fallback);

  // A refresh that fails keeps the map drawn: only a first read that fails,
  // a deleted map or one now hidden from the viewer (404) shows the error.
  if (live.gone || (map.isError && (!map.data || isNotFound(map.error)))) {
    return <MapNotFound roomId={roomId} />;
  }
  if (geographic && geo.isError && !geo.data) return <MapNotFound roomId={roomId} />;
  if (!map.data || (geographic && !geo.data)) return <FullPageLoader />;
  if (geographic) {
    return <GeoMapEditor key={map.data.id} roomId={roomId} map={geo.data!} currentUserId={currentUserId} />;
  }
  return <MapEditor key={map.data.id} roomId={roomId} map={map.data} currentUserId={currentUserId} />;
}

function MapNotFound({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  return (
    <FullPageMessage actionLabel={t('maps.backToMaps')} actionTo={`/rooms/${roomId}/maps`}>
      {t('maps.notFound')}
    </FullPageMessage>
  );
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
    // Settings, deletion and a geographic map's plane stay with its creator and the Master (spec 42 Decision 5).
    manages: map.canManage && !readOnly,
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
  const autosave = useBoardAutosave<Board, RelationshipMapDetail>(
    { groups: map.groups, cards: map.cards, arrows: map.arrows },
    map.revision,
    useSaveBoard(roomId, map.id),
    toBoardBody,
    (saved) => ({ groups: saved.groups, cards: saved.cards, arrows: saved.arrows }),
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
        // On a phone a Document opens under the map.
        onSelectDocument={access.splitOpen || !access.wide ? access.split.open : undefined}
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
  const autosave = useBoardAutosave<GeoBoard, GeoMapDetail>(
    { areas: map.areas, pins: map.pins, links: map.links },
    map.revision,
    useSaveGeo(roomId, map.id),
    toGeoBody,
    (saved) => ({ areas: saved.areas, pins: saved.pins, links: saved.links }),
  );
  const [planeOpened, setPlaneOpened] = useState(false);
  const exportMap = useExportMap(roomId, map.id, map.name);
  const { split } = access;
  const board = autosave.value;
  // What the pane shows on the map: a plain place (spec 50) or a Document's place.
  const pickedPlace = parsePlaceSide(split.sideId);
  const paneItem = pickedPlace ?? (split.sideId ? placeOfDocument(board, split.sideId) : null);
  const openPlace = (ref: GeoItemRef) => split.open(placeSide(ref));

  return (
    <MapChrome
      roomId={roomId}
      map={map}
      access={access}
      autosave={autosave}
      renderSide={() =>
        pickedPlace && (
          <PlaceSidePane
            board={board}
            place={pickedPlace}
            // A linked Document's place opens the Document, a plain one opens here.
            onPick={(item, ref) => (item.documentId ? split.open(item.documentId) : openPlace(ref))}
            onClose={split.close}
          />
        )
      }
      actions={
        <>
          <Menu.Item
            leftSection={<DownloadSimpleIcon size={18} />}
            disabled={exportMap.isPending}
            onClick={() => exportMap.mutate(undefined, { onError: (error) => notifyError(error) })}
          >
            {t('maps.geo.export')}
          </Menu.Item>
          {access.manages && (
            <Menu.Item leftSection={<MapTrifoldIcon size={18} />} onClick={() => setPlaneOpened(true)}>
              {t('maps.geo.planeTitle')}
            </Menu.Item>
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
        // A click on a Document's place opens it beside the map (spec 38b), or under it on a phone.
        onSelectDocument={access.split.open}
        // A plain place opens there too (spec 50).
        onSelectPlace={openPlace}
        paneItem={paneItem}
        // On a phone the board takes the plane's shape, so the map fills it.
        fitToPlane={!access.wide}
      />
      {planeOpened && <GeoMapDialog roomId={roomId} map={map} onClose={() => setPlaneOpened(false)} />}
    </MapChrome>
  );
}

/**
 * What every map page has around its board: the name, description and
 * visibility, the save status, and a ⋮ menu with the split toggle, the map's
 * own `actions` and, for whoever manages the map, its settings and deletion.
 */
function MapChrome({
  roomId,
  map,
  access,
  autosave,
  actions,
  renderSide,
  children,
}: {
  roomId: string;
  map: RelationshipMap;
  access: ReturnType<typeof useMapAccess>;
  autosave: { saveState: SaveState; retry: () => void; error: Error | null };
  actions?: ReactNode;
  /** What the split shows for a geographic map's place (spec 50). */
  renderSide?: (sideId: string) => ReactNode | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { readOnly, wide, members } = access;
  const updateMap = useUpdateMap(roomId, map.id);
  const deleteMap = useDeleteMap(roomId, map.id);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const { saveState } = autosave;
  const { split } = access;
  const splitShown = split.sideId !== null;
  const { manages } = access;
  const hasActions = wide || actions !== undefined || manages;

  const status: Record<SaveState, string | null> = {
    idle: null,
    pending: t('maps.unsaved'),
    saving: t('maps.saving'),
    saved: t('maps.saved'),
    error: autosave.error?.message || t('maps.saveError'),
  };

  return (
    <PageLayout allowEmptySide renderSide={renderSide} backTo={`/rooms/${roomId}/maps`} backLabel={t('maps.backToMaps')} roomId={roomId}>
      {/* One line: the name, cut short if long, and the actions in a ⋮
          menu beside it; under it the description, cut to two lines until a
          tap opens it in full (and another closes it). */}
      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap" align="center">
          <Title
            order={1}
            fz="h2"
            lineClamp={1}
            title={map.name}
            style={{ fontFamily: 'var(--font-display)', minWidth: 0, flex: '0 1 auto' }}
          >
            {map.name}
          </Title>
          <VisibilityBadge visibility={map.visibility} compact={!wide} />
          {map.playersCanEdit && (
            <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }}>
              {t('maps.unlockedBadge')}
            </Badge>
          )}
          <Group gap="xs" wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
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
            {hasActions && (
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <LabeledActionIcon variant="subtle" color="gray" size="lg" aria-label={t('maps.actions', { name: map.name })}>
                    <DotsThreeVerticalIcon size={24} />
                  </LabeledActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {wide && (
                    <Menu.Item
                      leftSection={<SquareSplitHorizontalIcon size={18} />}
                      onClick={() => (splitShown ? split.close() : split.open(''))}
                    >
                      {splitShown ? t('documents.open.hideSplit') : t('documents.open.showSplit')}
                    </Menu.Item>
                  )}
                  {actions}
                  {manages && (
                    <>
                      <Menu.Item leftSection={<GearIcon size={18} />} onClick={() => setSettingsOpened(true)}>
                        {t('maps.settings')}
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item color="red" leftSection={<TrashIcon size={18} />} onClick={() => setDeleteOpened(true)}>
                        {t('maps.delete')}
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
        {map.description && (
          <Text
            size="sm"
            c="dimmed"
            lineClamp={descriptionOpen ? undefined : 2}
            role="button"
            tabIndex={0}
            aria-expanded={descriptionOpen}
            onClick={() => setDescriptionOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setDescriptionOpen((open) => !open);
              }
            }}
            style={{ whiteSpace: 'pre-line', cursor: 'pointer' }}
          >
            {map.description}
          </Text>
        )}
      </Stack>
      {map.canEdit && !readOnly && !wide && (
        <Text size="sm" c="dimmed">
          {t('maps.readOnlyOnPhone')}
        </Text>
      )}
      <Box data-split-anchor data-tour="map">
        {children}
      </Box>
      {settingsOpened && (
        <MapFormModal
          title={t('maps.settings')}
          initialValues={{
            name: map.name,
            description: map.description,
            visibility: map.visibility,
            selectiveUserIds: map.selectiveUserIds ?? [],
            playersCanEdit: map.playersCanEdit,
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
