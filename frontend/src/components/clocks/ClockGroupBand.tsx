import type { ReactNode } from 'react';
import { Alert, Badge, Button, Card, Group, Menu, Stack, Text, Title } from '@mantine/core';
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { groupResultLine, type GroupPrompt } from '../../lib/clocks';
import type { Clock, ClockGroup } from '../../types/clock';
import { LabeledActionIcon } from '../LabeledActionIcon';

/** What a band's Master controls ask the page to do; none for a Player. */
export interface GroupBandActions {
  onEdit: (group: ClockGroup) => void;
  onNewTurn: (group: ClockGroup) => void;
  onArchive: (group: ClockGroup, archived: boolean) => void;
  onDelete: (group: ClockGroup) => void;
  /** "Conferma" on a race, "Termina la svolta" on a turn. */
  onEnd: (group: ClockGroup) => void;
  onReveal: (clock: Clock) => void;
  /** "Non ancora" / "Non ora": the prompt goes away until something changes. */
  onDismiss: (group: ClockGroup) => void;
  pending: boolean;
}

/**
 * A group's band on the Clocks page (spec 61 Decisions 11, 12, 17): its name,
 * its mode, its result once ended, and for the Master the ⋮ menu and the
 * prompt the group waits on (a race's winner, a turn's end, a sequence's
 * next clock to reveal).
 */
export function ClockGroupBand({
  group,
  clocks,
  archived,
  prompt,
  actions,
  children,
}: {
  group: ClockGroup;
  /** The Room's clocks the viewer sees, to name the result. */
  clocks: Clock[];
  /** Whether every clock of the group is archived (the band then offers "Ripristina"). */
  archived: boolean;
  prompt: GroupPrompt | null;
  actions?: GroupBandActions;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const result = group.ended ? groupResultLine(group.result, clocks) : null;
  const quoted = (list: Clock[]) => list.map((clock) => t('clocks.groups.quoted', { name: clock.name })).join(', ');

  return (
    <Card withBorder radius="md" p="lg" component="section" aria-label={group.name}>
      <Group gap="sm" mb="sm" wrap="wrap">
        <Title order={2} fz="h4" style={{ fontFamily: 'var(--font-display)' }}>
          {group.name}
        </Title>
        <Badge variant="outline" color="gray" size="sm">
          {t(`clocks.groupMode.${group.mode}`)}
        </Badge>
        {group.ended && (
          <Badge variant="light" color="gray" size="sm">
            {t('clocks.groupEnded')}
          </Badge>
        )}
        {result && (
          <Text size="sm" fw={600}>
            {result}
          </Text>
        )}
        {actions && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <LabeledActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                ml="auto"
                aria-label={t('clocks.groups.menu', { name: group.name })}
              >
                <DotsThreeVerticalIcon size={18} />
              </LabeledActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<PencilSimpleIcon size={16} />} onClick={() => actions.onEdit(group)}>
                {t('common.edit')}
              </Menu.Item>
              {group.ended && group.mode === 'turn' && (
                <Menu.Item leftSection={<PlusIcon size={16} />} onClick={() => actions.onNewTurn(group)}>
                  {t('clocks.groups.newTurn')}
                </Menu.Item>
              )}
              <Menu.Item
                leftSection={archived ? <ArrowCounterClockwiseIcon size={16} /> : <ArchiveIcon size={16} />}
                onClick={() => actions.onArchive(group, !archived)}
              >
                {archived ? t('clocks.groups.restore') : t('clocks.groups.archive')}
              </Menu.Item>
              <Menu.Item color="danger" leftSection={<TrashIcon size={16} />} onClick={() => actions.onDelete(group)}>
                {t('clocks.groups.delete')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {actions && prompt && (
        <Alert color="yellow" variant="light" mb="md" role="status">
          <Stack gap="xs">
            <Text size="sm">
              {prompt.kind === 'race'
                ? prompt.clocks.length > 1
                  ? t('clocks.groups.raceTie', { names: quoted(prompt.clocks) })
                  : t('clocks.groups.raceOne', { names: quoted(prompt.clocks) })
                : prompt.kind === 'turn'
                  ? t('clocks.groups.turnEnds', {
                      labels: prompt.clocks
                        .map((clock) => t('clocks.groups.outcome', { name: clock.name, label: clock.decisiveLabel }))
                        .join(', '),
                    })
                  : t('clocks.groups.reveal', { name: prompt.clock.name })}
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                loading={actions.pending}
                onClick={() =>
                  prompt.kind === 'reveal' ? actions.onReveal(prompt.clock) : actions.onEnd(group)
                }
              >
                {prompt.kind === 'race'
                  ? t('clocks.groups.confirm')
                  : prompt.kind === 'turn'
                    ? t('clocks.groups.endTurn')
                    : t('clocks.groups.revealButton')}
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => actions.onDismiss(group)}>
                {prompt.kind === 'reveal' ? t('clocks.groups.notNow') : t('clocks.groups.notYet')}
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      <Group gap="xl" align="flex-start">
        {children}
      </Group>
    </Card>
  );
}
