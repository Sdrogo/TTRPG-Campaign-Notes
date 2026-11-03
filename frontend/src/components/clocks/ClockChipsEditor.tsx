import { useState } from 'react';
import { Button, Group, ScrollArea, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Chip, Picker } from '../landing/BlockBar';
import { DragHandle, SortableItem, SortableList } from '../landing/Sortable';
import { useClockGroups, useClockRules, useClocks, useCreateClock } from '../../hooks/useClocks';
import { useDocuments } from '../../hooks/useDocuments';
import { useMembers } from '../../hooks/useMembers';
import { useRoom } from '../../hooks/useRooms';
import { emptySettings } from '../../lib/clocks';
import type { Clock, ClockGroup } from '../../types/clock';
import type { BlockInput, ClockChip } from '../../types/landing';
import { ClockDialog } from './ClockDialog';

/** A Clocks block names at most this many clocks and groups (spec 61 Decision 31). */
export const MAX_CLOCK_CHIPS = 20;

function chipKey(chip: ClockChip): string {
  return chip.clockId !== null ? `clock:${chip.clockId}` : `group:${chip.groupId}`;
}

function chipOf(key: string): ClockChip {
  const [kind, id] = key.split(':');
  return kind === 'clock' ? { clockId: id, groupId: null } : { clockId: null, groupId: id };
}

/**
 * A Clocks block's part of its bar (spec 61 Decision 18): "Tutti i clock
 * aperti", or the chips of its clocks and groups, dragged to reorder, ×
 * to remove; "+ Clock" picks one more, or "Nuovo clock…" opens the clock
 * dialog and adds the clock it makes (on the Clocks page, like every clock).
 */
export function ClockChipsEditor({
  roomId,
  currentUserId,
  block,
  initialOpen = false,
  onChange,
  onCancelDraft,
}: {
  roomId: string;
  currentUserId: string;
  block: BlockInput;
  /** A new block opens its picker at once. */
  initialOpen?: boolean;
  onChange: (block: BlockInput) => void;
  /** A block not saved yet: closing its picker empty drops it. */
  onCancelDraft?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initialOpen);
  const [creating, setCreating] = useState(false);
  const clocks = useClocks(roomId);
  const groups = useClockGroups(roomId);
  const rules = useClockRules(roomId);
  const members = useMembers(roomId, creating);
  const documents = useDocuments(roomId, creating);
  const room = useRoom(roomId, creating);
  const createClock = useCreateClock(roomId);

  const chips = block.clockChips;
  const keys = chips.map(chipKey);
  const pickable = (clocks.data ?? []).filter((clock) => !clock.archived && clock.state !== 'proposed');
  const clockName = (id: string) => pickable.find((clock) => clock.id === id)?.name;
  const groupName = (id: string) => groups.data?.find((group) => group.id === id)?.name;
  const label = (chip: ClockChip) =>
    chip.clockId !== null
      ? (clockName(chip.clockId) ?? t('clocks.block.missing'))
      : t('clocks.block.groupChip', { name: groupName(chip.groupId) ?? t('clocks.block.missing') });
  const freeGroups = (groups.data ?? []).filter((group) => !keys.includes(`group:${group.id}`));
  const freeClocks = pickable.filter((clock) => !keys.includes(`clock:${clock.id}`));
  const full = chips.length >= MAX_CLOCK_CHIPS;

  const close = () => {
    setOpen(false);
    onCancelDraft?.();
  };
  const add = (chip: ClockChip) => {
    setOpen(false);
    onChange({ ...block, allClocks: false, clockChips: [...chips, chip] });
  };

  return (
    <>
      <Switch
        size="sm"
        label={t('clocks.block.allOpen')}
        checked={block.allClocks}
        onChange={(event) => onChange({ ...block, allClocks: event.currentTarget.checked })}
      />
      {!block.allClocks && (
        <>
          <SortableList ids={keys} layout="horizontal" onMove={(ids) => onChange({ ...block, clockChips: ids.map(chipOf) })}>
            {chips.map((chip) => (
              <SortableItem key={chipKey(chip)} id={chipKey(chip)}>
                {({ ref, style }) => (
                  <Group ref={ref} style={style} gap={0} wrap="nowrap">
                    <DragHandle size="xs" label={t('roomLanding.edit.dragFeature', { name: label(chip) })} />
                    <Chip
                      label={label(chip)}
                      removeLabel={t('roomLanding.edit.remove', { name: label(chip) })}
                      onRemove={() => onChange({ ...block, clockChips: chips.filter((other) => other !== chip) })}
                    />
                  </Group>
                )}
              </SortableItem>
            ))}
          </SortableList>
          <Picker
            opened={open}
            onClose={close}
            title={t('clocks.block.add')}
            target={
              <Button size="compact-sm" variant="subtle" leftSection={<PlusIcon size={14} />} disabled={full} onClick={() => setOpen(true)}>
                {t('clocks.block.add')}
              </Button>
            }
          >
            <Stack gap="xs">
              <ScrollArea.Autosize mah={260}>
                <Stack gap={2}>
                  {freeGroups.length === 0 && freeClocks.length === 0 && (
                    <Text size="xs" c="dimmed">
                      {t('clocks.block.noneLeft')}
                    </Text>
                  )}
                  {freeGroups.map((group: ClockGroup) => (
                    <UnstyledButton key={group.id} className="room-landing-option" onClick={() => add({ clockId: null, groupId: group.id })}>
                      {t('clocks.block.groupChip', { name: group.name })}
                    </UnstyledButton>
                  ))}
                  {freeClocks.map((clock: Clock) => (
                    <UnstyledButton key={clock.id} className="room-landing-option" onClick={() => add({ clockId: clock.id, groupId: null })}>
                      {clock.name}
                    </UnstyledButton>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<PlusIcon size={14} />}
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                {t('clocks.block.newClock')}
              </Button>
            </Stack>
          </Picker>
        </>
      )}
      {creating && rules.data && members.data && (
        <ClockDialog
          roomId={roomId}
          title={t('clocks.create')}
          submitLabel={t('clocks.dialog.submitCreate')}
          initialValues={{
            ...emptySettings(),
            name: '',
            documentId: null,
            visibility: room.data?.defaultVisibility ?? 'room',
            selectiveUserIds: [],
          }}
          rules={rules.data}
          isMaster
          isCreate
          documents={documents.data ?? []}
          members={members.data}
          creatorId={currentUserId}
          submitting={createClock.isPending}
          error={createClock.error?.message ?? null}
          onClose={() => {
            createClock.reset();
            setCreating(false);
            onCancelDraft?.();
          }}
          onSubmit={(values) =>
            createClock.mutate(values, {
              onSuccess: (clock) => {
                setCreating(false);
                add({ clockId: clock.id, groupId: null });
              },
            })
          }
        />
      )}
    </>
  );
}
