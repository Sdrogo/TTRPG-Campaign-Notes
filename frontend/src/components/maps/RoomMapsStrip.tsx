import { Badge, Button, Group, Text, UnstyledButton } from '@mantine/core';
import { GraphIcon, MapTrifoldIcon, PlusIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMaps } from '../../hooks/useMaps';

interface RoomMapsStripProps {
  roomId: string;
  /** Offers "New map" (on the Maps page) when the Room has none the viewer sees. */
  canCreate: boolean;
}

/**
 * One compact row on the Room's main page with the maps the viewer sees, last
 * edited first, so the maps are in sight without opening the Room's "⋮"
 * (Andrea, 2026-10-25). "Maps" with its count leads to the Maps page; each
 * map opens directly. The row scrolls sideways rather than wrapping, so it
 * stays one line on a phone. Hidden while loading, on an error, and when
 * there is no map and nothing to create. The list already follows each
 * map's visibility (and "View as"), like the Maps page.
 */
export function RoomMapsStrip({ roomId, canCreate }: RoomMapsStripProps) {
  const { t } = useTranslation();
  const maps = useMaps(roomId, true);

  if (!maps.data || (maps.data.length === 0 && !canCreate)) return null;

  return (
    <Group
      component="nav"
      aria-label={t('maps.title')}
      gap="xs"
      wrap="nowrap"
      className="room-maps-strip"
    >
      <UnstyledButton
        component={Link}
        to={`/rooms/${roomId}/maps`}
        aria-label={t('maps.strip.all', { count: maps.data.length })}
        c="dimmed"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
      >
        <MapTrifoldIcon size={18} aria-hidden="true" />
        <Text span fw={600} size="sm" style={{ fontFamily: 'var(--font-display)' }}>
          {t('maps.title')}
        </Text>
        <Badge size="sm" variant="light" color="gray" circle aria-hidden="true">
          {maps.data.length}
        </Badge>
      </UnstyledButton>
      {maps.data.map((map) => (
        <Button
          key={map.id}
          component={Link}
          to={`/rooms/${roomId}/maps/${map.id}`}
          size="compact-sm"
          variant="default"
          radius="xl"
          leftSection={
            map.kind === 'geographic' ? (
              <MapTrifoldIcon size={14} aria-hidden="true" />
            ) : (
              <GraphIcon size={14} aria-hidden="true" />
            )
          }
          style={{ flexShrink: 0, maxWidth: 240 }}
        >
          {map.name}
        </Button>
      ))}
      {maps.data.length === 0 && (
        <Button
          component={Link}
          to={`/rooms/${roomId}/maps?new=1`}
          size="compact-sm"
          variant="subtle"
          radius="xl"
          leftSection={<PlusIcon size={14} aria-hidden="true" />}
          style={{ flexShrink: 0 }}
        >
          {t('maps.create')}
        </Button>
      )}
    </Group>
  );
}
