import { ActionIcon, Box, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MarkdownText } from '../mentions/MarkdownText';
import { placeConnections, placeName, placeSubtitle, findItem, type GeoItemRef } from '../../lib/geoMaps';
import type { GeoArea, GeoBoard, GeoPin } from '../../types/geoMap';

/**
 * A geographic map's plain area or pin opened beside the map (spec 50
 * Decision 3): the header a Document's pane has, then the area's subtitle,
 * the note as Markdown and the places linked to it. A click on one opens it
 * here instead, as `onPick` decides.
 */
export function PlaceSidePane({
  board,
  place,
  onPick,
  onClose,
}: {
  board: GeoBoard;
  place: GeoItemRef;
  onPick: (item: GeoArea | GeoPin, ref: GeoItemRef) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const item = findItem(board, place);
  const subtitle = item && 'points' in item ? placeSubtitle(item) : null;
  const connections = item ? placeConnections(board, place) : [];

  return (
    <Box
      component="aside"
      aria-label={t('maps.geo.placePane')}
      style={{ position: 'sticky', top: 0, maxHeight: '100dvh', overflowY: 'auto' }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        py={6}
        px="xs"
        mb="sm"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <Text fw={600} truncate c={item ? undefined : 'dimmed'} style={{ fontFamily: 'var(--font-display)' }}>
          {item ? placeName(item) : t('maps.geo.placeNotFound')}
        </Text>
        <Tooltip label={t('documents.open.close')}>
          <ActionIcon variant="subtle" aria-label={t('documents.open.close')} onClick={onClose}>
            <XIcon size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {item && (
        <Stack gap="md" px="xs" pb="md">
          {subtitle && <Text c="dimmed">{subtitle}</Text>}
          {item.note ? (
            <MarkdownText text={item.note} style={{ overflowWrap: 'anywhere' }} />
          ) : (
            <Text c="dimmed">{t('maps.geo.noNote')}</Text>
          )}
          {connections.length > 0 && (
            <Stack gap={4}>
              <Text fw={600}>{t('maps.geo.connections')}</Text>
              {connections.map((connection) => (
                <UnstyledButton
                  key={connection.linkId}
                  onClick={() => onPick(connection.item, connection.ref)}
                  py={4}
                  style={{ display: 'block' }}
                >
                  <Text component="span" c="var(--accent-primary)" fw={500}>
                    {placeName(connection.item)}
                  </Text>
                  {connection.label && (
                    <Text component="span" c="dimmed">
                      {' · '}
                      {connection.label}
                    </Text>
                  )}
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
}
