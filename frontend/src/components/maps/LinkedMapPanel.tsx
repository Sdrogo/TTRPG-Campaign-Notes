import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowsOutIcon, LinkBreakIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useBackState } from '../../lib/backNav';
import { useTranslation } from 'react-i18next';
import { useGeoMap } from '../../hooks/useGeoMap';
import { useUnlinkMap } from '../../hooks/useMentionMap';
import { ignoreBoardChange } from '../../lib/maps';
import type { RelationshipMapDetail } from '../../types/map';
import { GeographicBoard } from './GeographicBoard';
import { MapBoard } from './MapBoard';

/** The board's height on the Document page, like the mention map's. */
const PANEL_HEIGHT = 360;

/**
 * A map linked to the Document (spec 36 Decision 15), on its page under its
 * images: a free board, or a geographic map (spec 38), read-only there,
 * with a link to the map's own page, and, for whoever manages the map, a
 * button taking it off the Document's page.
 */
export function LinkedMapPanel({
  roomId,
  documentId,
  map,
  canUnlink,
}: {
  roomId: string;
  documentId: string;
  map: RelationshipMapDetail;
  canUnlink: boolean;
}) {
  const { t } = useTranslation();
  const backState = useBackState();
  const unlink = useUnlinkMap(roomId, documentId);
  return (
    <Stack gap={4} component="section" aria-label={map.name}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600} truncate>
          {map.name}
        </Text>
        <Group gap={2} wrap="nowrap">
          {canUnlink && (
            <Tooltip label={t('maps.mention.unlink')} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                loading={unlink.isPending}
                onClick={() => unlink.mutate()}
                aria-label={t('maps.mention.unlink')}
              >
                <LinkBreakIcon size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t('maps.mention.fullScreen')} withArrow>
            <ActionIcon
              component={Link}
              to={`/rooms/${roomId}/maps/${map.id}`}
              state={backState}
              variant="subtle"
              color="gray"
              aria-label={t('maps.mention.fullScreen')}
            >
              <ArrowsOutIcon size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {map.kind === 'geographic' ? (
        <LinkedGeoBoard roomId={roomId} mapId={map.id} />
      ) : (
        <MapBoard
          roomId={roomId}
          board={map}
          editable={false}
          isMaster={false}
          documents={[]}
          tags={[]}
          onChange={ignoreBoardChange}
          height={PANEL_HEIGHT}
        />
      )}
      {unlink.error && (
        <Text size="xs" c="red">
          {unlink.error.message}
        </Text>
      )}
    </Stack>
  );
}

/** A linked geographic map's plane, read from `.../geo` (spec 38_2); nothing while it loads or if it fails. */
function LinkedGeoBoard({ roomId, mapId }: { roomId: string; mapId: string }) {
  const geo = useGeoMap(roomId, mapId, true);
  if (!geo.data) return null;
  return (
    <GeographicBoard
      roomId={roomId}
      board={geo.data}
      planeWidth={geo.data.planeWidth}
      planeHeight={geo.data.planeHeight}
      backgroundUrl={geo.data.backgroundUrl}
      editable={false}
      isMaster={false}
      documents={[]}
      tags={[]}
      onChange={ignoreBoardChange}
      height={PANEL_HEIGHT}
    />
  );
}
