import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowsOutIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useBackState } from '../../lib/backNav';
import { useTranslation } from 'react-i18next';
import { ignoreBoardChange } from '../../lib/maps';
import type { MentionMap } from '../../types/map';
import { MapBoard } from './MapBoard';

/** The board's height on the Document page (spec 36 Decision 12). */
const PANEL_HEIGHT = 360;

/**
 * A Document's mention map on its page, under its images (spec 36 Decision
 * 12): read-only there (pan, zoom, open a Document), with a link to the full
 * page, where its creator and the Master move and recolor cards.
 */
export function MentionMapPanel({ roomId, map }: { roomId: string; map: MentionMap }) {
  const { t } = useTranslation();
  const backState = useBackState();
  const fullPage = `/rooms/${roomId}/documents/${map.documentId}/mention-map`;
  return (
    <Stack gap={4} component="section" aria-label={t('maps.mention.title')}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>
          {t('maps.mention.title')}
        </Text>
        <Tooltip label={t('maps.mention.fullScreen')} withArrow>
          <ActionIcon
            component={Link}
            to={fullPage}
            state={backState}
            variant="subtle"
            color="gray"
            aria-label={t('maps.mention.fullScreen')}
          >
            <ArrowsOutIcon size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <MapBoard
        roomId={roomId}
        board={map}
        editable={false}
        isMaster={false}
        documents={[]}
        tags={[]}
        onChange={ignoreBoardChange}
        mode="mention"
        height={PANEL_HEIGHT}
      />
      {map.documentsLeftOut > 0 && (
        <Text size="xs" c="dimmed">
          {t('maps.mention.leftOut', { number: map.documentsLeftOut })}
        </Text>
      )}
    </Stack>
  );
}
