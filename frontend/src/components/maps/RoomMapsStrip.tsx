import { Badge, Card, Group, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
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
 * The maps the viewer sees on the Room's main page, as small cards, last
 * edited first, so they are in sight without opening the Room's "⋮" (Andrea,
 * 2026-10-25). "Maps" with its count leads to the Maps page; each card opens
 * its map and says its kind and how many Documents it shows. The cards wrap,
 * one per row on a phone (Andrea, 2026-10-25: no sideways scrolling).
 * Hidden while loading, on an error, and when there is no map and nothing to
 * create. The list already follows each map's visibility (and "View as"),
 * like the Maps page.
 */
export function RoomMapsStrip({ roomId, canCreate }: RoomMapsStripProps) {
  const { t } = useTranslation();
  const maps = useMaps(roomId, true);

  if (!maps.data || (maps.data.length === 0 && !canCreate)) return null;

  return (
    <Stack component="nav" aria-label={t('maps.title')} gap="xs">
      <UnstyledButton
        component={Link}
        to={`/rooms/${roomId}/maps`}
        aria-label={t('maps.strip.all', { count: maps.data.length })}
        c="dimmed"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
      >
        <MapTrifoldIcon size={16} aria-hidden="true" />
        <Text span fz="h5" style={{ fontFamily: 'var(--font-display)' }}>
          {t('maps.title')}
        </Text>
        <Badge size="sm" variant="light" color="gray" circle aria-hidden="true">
          {maps.data.length}
        </Badge>
      </UnstyledButton>
      <div className="room-maps-cards">
        {maps.data.map((map) => (
          <Card
            key={map.id}
            component={Link}
            to={`/rooms/${roomId}/maps/${map.id}`}
            withBorder
            radius="md"
            padding="sm"
            className="room-map-card"
          >
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="accent" size="lg" radius="md" aria-hidden="true">
                {map.kind === 'geographic' ? <MapTrifoldIcon size={18} /> : <GraphIcon size={18} />}
              </ThemeIcon>
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} truncate="end" title={map.name} style={{ fontFamily: 'var(--font-display)' }}>
                  {map.name}
                </Text>
                <Text size="xs" c="dimmed" truncate="end">
                  {t(map.kind === 'geographic' ? 'maps.kind.geographic' : 'maps.kind.free')} ·{' '}
                  {t('maps.documentCount', { count: map.documentCount })}
                </Text>
              </Stack>
            </Group>
          </Card>
        ))}
        {maps.data.length === 0 && (
          <Card
            component={Link}
            to={`/rooms/${roomId}/maps?new=1`}
            withBorder
            radius="md"
            padding="sm"
            className="room-map-card"
            style={{ borderStyle: 'dashed' }}
          >
            <Group gap="sm" wrap="nowrap" c="dimmed">
              <ThemeIcon variant="default" size="lg" radius="md" aria-hidden="true">
                <PlusIcon size={18} />
              </ThemeIcon>
              <Text fw={600}>{t('maps.create')}</Text>
            </Group>
          </Card>
        )}
      </div>
    </Stack>
  );
}
