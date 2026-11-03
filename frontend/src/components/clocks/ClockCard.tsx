import { Anchor, Badge, Box, Group, Menu, Stack, Text } from '@mantine/core';
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  ClockCounterClockwiseIcon,
  DotsThreeVerticalIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  StackPlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { colorValue } from '../../lib/maps';
import { isMarkable, isUnmarkable, stateLabel, usableKinds } from '../../lib/clocks';
import { useBackState } from '../../lib/backNav';
import type { Clock, ClockLabel, MarkKind } from '../../types/clock';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { ClockFace, type ClockFaceSize } from './ClockFace';

/** What a card's menu can ask its page to do; a missing one hides its item. */
export interface ClockCardActions {
  onMark: (clock: Clock, delta: number, kindId?: string | null) => void;
  onMarkMany?: (clock: Clock) => void;
  onHistory?: (clock: Clock) => void;
  onEdit?: (clock: Clock) => void;
  onArchive?: (clock: Clock, archived: boolean) => void;
  onDelete?: (clock: Clock) => void;
}

/**
 * One clock (spec 61 Decision 24): its face, name (two lines at most), "4/8",
 * label badges, closing condition and state; "−" / "+" under it for who may
 * mark it (Decision 7), "▾" beside "+" to pick a mark kind (Decision 8), and
 * the ⋮ menu (mark several, history, edit, archive, delete) as rights allow.
 */
export function ClockCard({
  roomId,
  clock,
  kinds,
  labels,
  isMaster,
  glowing = false,
  size = 'md',
  actions,
}: {
  roomId: string;
  clock: Clock;
  kinds: MarkKind[];
  labels: ClockLabel[];
  isMaster: boolean;
  glowing?: boolean;
  size?: ClockFaceSize;
  actions: ClockCardActions;
}) {
  const { t } = useTranslation();
  const backState = useBackState();
  const markable = isMarkable(clock);
  const unmarkable = isUnmarkable(clock);
  const kindChoices = markable ? usableKinds(kinds, isMaster) : [];
  const clockLabels = clock.labelIds.flatMap((id) => labels.filter((label) => label.id === id));
  const showState = clock.state !== 'open' || clock.archived || clock.locked;
  const manage = clock.canManage;

  return (
    <Stack gap={6} align="center" className="clock-card" w={size === 'lg' ? 220 : 180}>
      <Box pos="relative">
        <ClockFace
          clock={clock}
          kinds={kinds}
          size={size}
          glowing={glowing}
          onMark={markable || unmarkable ? (delta) => actions.onMark(clock, delta) : undefined}
        />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <LabeledActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t('clocks.card.menu', { name: clock.name })}
              className="clock-card-menu"
            >
              <DotsThreeVerticalIcon size={18} />
            </LabeledActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {markable && actions.onMarkMany && (
              <Menu.Item leftSection={<StackPlusIcon size={16} />} onClick={() => actions.onMarkMany?.(clock)}>
                {t('clocks.card.markMany')}
              </Menu.Item>
            )}
            {actions.onHistory && (
              <Menu.Item
                leftSection={<ClockCounterClockwiseIcon size={16} />}
                onClick={() => actions.onHistory?.(clock)}
              >
                {t('clocks.card.history')}
              </Menu.Item>
            )}
            {manage && actions.onEdit && (
              <Menu.Item leftSection={<PencilSimpleIcon size={16} />} onClick={() => actions.onEdit?.(clock)}>
                {t('common.edit')}
              </Menu.Item>
            )}
            {manage && actions.onArchive && clock.state !== 'proposed' && (
              <Menu.Item
                leftSection={
                  clock.archived ? <ArrowCounterClockwiseIcon size={16} /> : <ArchiveIcon size={16} />
                }
                onClick={() => actions.onArchive?.(clock, !clock.archived)}
              >
                {clock.archived ? t('clocks.card.restore') : t('clocks.card.archive')}
              </Menu.Item>
            )}
            {manage && actions.onDelete && (
              <Menu.Item
                color="danger"
                leftSection={<TrashIcon size={16} />}
                onClick={() => actions.onDelete?.(clock)}
              >
                {t('common.delete')}
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Box>
      <Text
        ta="center"
        fw={600}
        lineClamp={2}
        style={{ fontFamily: 'var(--font-display)' }}
        fz={size === 'sm' ? 'sm' : 'md'}
      >
        {clock.name}
      </Text>
      <Text size="xs" c="dimmed" ff="monospace">
        {t('clocks.card.progress', { filled: clock.filled, segments: clock.segments })}
      </Text>
      {(clockLabels.length > 0 || showState) && (
        <Group gap={4} justify="center">
          {showState && (
            <Badge size="sm" variant="light" color={clock.state === 'closed' ? 'green' : 'gray'}>
              {stateLabel(clock)}
            </Badge>
          )}
          {clockLabels.map((label) => (
            <Badge
              key={label.id}
              size="sm"
              variant="light"
              style={{ color: colorValue(label.color), background: 'var(--bg-raised)' }}
            >
              {label.name}
            </Badge>
          ))}
        </Group>
      )}
      {clock.decisiveLabel && (
        <Badge size="sm" variant="outline" color="gray">
          {clock.decisiveLabel}
        </Badge>
      )}
      {clock.closingCondition && (
        <Text size="xs" c="dimmed" ta="center" lineClamp={2}>
          {clock.closingCondition}
        </Text>
      )}
      {clock.document && (
        <Anchor
          component={Link}
          to={`/rooms/${roomId}/documents/${clock.document.id}`}
          state={backState}
          size="xs"
        >
          {t('clocks.card.document', { name: clock.document.name })}
        </Anchor>
      )}
      {(markable || unmarkable) && (
        <Group gap={6} justify="center" wrap="nowrap">
          {unmarkable && (
            <LabeledActionIcon
              variant="default"
              size="md"
              aria-label={t('clocks.card.minus', { name: clock.name })}
              onClick={() => actions.onMark(clock, -1)}
            >
              <MinusIcon size={16} />
            </LabeledActionIcon>
          )}
          {markable && (
            <LabeledActionIcon
              variant="default"
              size="md"
              aria-label={t('clocks.card.plus', { name: clock.name })}
              onClick={() => actions.onMark(clock, 1)}
            >
              <PlusIcon size={16} />
            </LabeledActionIcon>
          )}
          {kindChoices.length > 0 && (
            <Menu position="bottom" withinPortal>
              <Menu.Target>
                <LabeledActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('clocks.card.pickKind', { name: clock.name })}
                >
                  <CaretDownIcon size={14} />
                </LabeledActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t('clocks.card.markWith')}</Menu.Label>
                {kindChoices.map((kind) => (
                  <Menu.Item
                    key={kind.id}
                    leftSection={<KindSwatch kind={kind} />}
                    onClick={() => actions.onMark(clock, 1, kind.id)}
                  >
                    {kind.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      )}
    </Stack>
  );
}

/** A mark kind's colour square, as in the legend. */
export function KindSwatch({ kind }: { kind: Pick<MarkKind, 'color'> }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      display="inline-block"
      w={12}
      h={12}
      style={{ background: colorValue(kind.color), borderRadius: 2 }}
    />
  );
}

/** The mark kinds' legend under a strip of clocks (Decision 8): "■ Successo (Giocatori)". */
export function MarkKindLegend({ kinds }: { kinds: MarkKind[] }) {
  const { t } = useTranslation();
  if (kinds.length === 0) return null;
  return (
    <Group gap="md" aria-label={t('clocks.legend')} role="list">
      {kinds.map((kind) => (
        <Group key={kind.id} gap={6} role="listitem" wrap="nowrap">
          <KindSwatch kind={kind} />
          <Text size="xs" c="dimmed">
            {t('clocks.legendItem', { name: kind.name, who: t(`clocks.who.${kind.who}`) })}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
