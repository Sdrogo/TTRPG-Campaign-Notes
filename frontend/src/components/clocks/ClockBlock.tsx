import { useEffect, useState, type ReactNode } from 'react';
import { ActionIcon, Box, Collapse, Group, Loader, Stack, Text } from '@mantine/core';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { BlockHeading } from '../landing/BlockHeading';
import { useClockGroups, useClockRules, useClocks } from '../../hooks/useClocks';
import { useClockEvents } from '../../hooks/useClockEvents';
import { useClockMarker } from '../../hooks/useClockMarker';
import { useMembers } from '../../hooks/useMembers';
import { useReadOnly } from '../../hooks/useViewAs';
import { blockClocks } from '../../lib/clocks';
import { REVEAL_BLOCK_EVENT, blockAnchor } from '../../lib/landing';
import type { Clock } from '../../types/clock';
import type { LandingBlock } from '../../types/landing';
import { ClockCard, MarkKindLegend, type ClockCardActions } from './ClockCard';
import { ClockHistoryModal } from './ClockHistoryModal';
import { MarkDialog } from './MarkDialog';

/**
 * A Clocks block of a Section (spec 61 Decision 18): its chips' clocks and
 * groups in order, or every open clock in the Clocks page's order, as a
 * wrapping strip of faces marked in place with the page's rights. The block
 * owns no clock. One the viewer sees nothing of is left out; the Master
 * reads "Niente da mostrare".
 */
export function ClockBlock({
  roomId,
  block,
  heading,
  isMaster,
  currentUserId,
  bar,
}: {
  roomId: string;
  block: LandingBlock;
  heading: string;
  isMaster: boolean;
  currentUserId: string;
  /** Edit mode's block bar, in place of the heading. */
  bar?: ReactNode;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const clocks = useClocks(roomId);
  const rules = useClockRules(roomId);
  const groups = useClockGroups(roomId);
  const members = useMembers(roomId, true);
  const glowing = useClockEvents(roomId, clocks.data, currentUserId);
  const marker = useClockMarker(roomId);
  const [dialog, setDialog] = useState<{ kind: 'mark' | 'history'; clock: Clock } | null>(null);
  const [expanded, setExpanded] = useState(!block.collapsed);
  useEffect(() => {
    const reveal = (event: Event) => {
      if ((event as CustomEvent<string>).detail === block.id) setExpanded(true);
    };
    window.addEventListener(REVEAL_BLOCK_EVENT, reveal);
    return () => window.removeEventListener(REVEAL_BLOCK_EVENT, reveal);
  }, [block.id]);

  const loading = !clocks.data || !groups.data || !rules.data;
  const shown = loading ? [] : blockClocks(block, clocks.data!, groups.data!);
  if (!loading && shown.length === 0 && !isMaster) return null;

  const kinds = rules.data?.markKinds ?? [];
  const actions: ClockCardActions = readOnly
    ? { onMark: () => undefined }
    : {
        onMark: (clock, delta, kindId) => marker.mark(clock, { delta, kindId }),
        onMarkMany: (clock) => setDialog({ kind: 'mark', clock }),
        onHistory: (clock) => setDialog({ kind: 'history', clock }),
      };

  let body: ReactNode;
  if (loading) {
    body = <Loader size="sm" color="accent" />;
  } else if (shown.length === 0) {
    body = (
      <Text c="dimmed" size="sm">
        {t('roomLanding.blockEmpty')}
      </Text>
    );
  } else {
    body = (
      <Stack gap="sm">
        <Group gap="lg" align="flex-start">
          {shown.map((clock) => (
            <ClockCard
              key={clock.id}
              roomId={roomId}
              clock={clock}
              kinds={kinds}
              labels={rules.data!.labels}
              isMaster={isMaster}
              glowing={glowing.has(clock.id)}
              size="sm"
              actions={actions}
            />
          ))}
        </Group>
        <MarkKindLegend kinds={kinds} />
      </Stack>
    );
  }

  const toggle = () => setExpanded((current) => !current);
  return (
    <Stack component="section" gap="sm" id={blockAnchor(block.id)} className="room-landing-block" aria-label={heading}>
      {bar ? (
        <Group gap={4} wrap="nowrap" align="flex-start">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            mt={2}
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={expanded ? t('roomLanding.foldBlock', { name: heading }) : t('roomLanding.unfoldBlock', { name: heading })}
          >
            {expanded ? <CaretDownIcon size={18} /> : <CaretRightIcon size={18} />}
          </ActionIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>{bar}</Box>
        </Group>
      ) : (
        <BlockHeading label={heading} count={loading ? undefined : shown.length} expanded={expanded} onToggle={toggle} />
      )}
      <Collapse expanded={expanded}>{body}</Collapse>
      {dialog?.kind === 'mark' && (
        <MarkDialog
          clock={dialog.clock}
          kinds={kinds}
          isMaster={isMaster}
          onClose={() => setDialog(null)}
          onSubmit={(input) => {
            marker.mark(dialog.clock, input);
            setDialog(null);
          }}
        />
      )}
      {members.data && dialog?.kind === 'history' && (
        <ClockHistoryModal
          roomId={roomId}
          clock={dialog.clock}
          kinds={kinds}
          members={members.data}
          onClose={() => setDialog(null)}
        />
      )}
    </Stack>
  );
}
