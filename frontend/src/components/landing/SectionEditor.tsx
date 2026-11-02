import { useState, type ReactNode } from 'react';
import { Box, Button, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PlusIcon } from '@phosphor-icons/react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BlockBar, BlockKindIcon, Picker } from './BlockBar';
import { DragHandle, SortableItem, SortableList } from './Sortable';
import { SectionBlock } from './SectionBlock';
import { blockContent, type BlockSources } from './blockItems';
import type { OpenInEditState } from './LandingEditor';
import { useSaveBlocks } from '../../hooks/useLanding';
import { useMainItems } from '../../hooks/useMainItems';
import { blockInput } from '../../lib/landing';
import { blockHeading } from '../../lib/landingText';
import { notifyError } from '../../lib/notify';
import type { BlockInput, BlockKind, LandingBlock, LandingSection, SessionZeroFeature } from '../../types/landing';

/** A Section holds at most this many blocks (spec 55 Decision 14). */
const MAX_BLOCKS = 10;
const UNDO_MS = 5_000;

/** A block added but not saved yet: a Documents block until its first Tag, a Session 0 one until its first feature. */
interface Draft {
  index: number;
  block: BlockInput;
}

/**
 * A custom Section in the Master's edit mode (spec 55 Decisions 11-15): the
 * same blocks as Players see, each under its block bar, reordered by drag;
 * a block's sub-sections (groups, features) dragged by their heading; "+
 * Blocco" after the last block, and a small "+" between two, opening the
 * three tiles. Every change saves the whole list at once.
 */
export function SectionEditor({ roomId, section, sources }: { roomId: string; section: LandingSection; sources: BlockSources }) {
  const { t } = useTranslation();
  const location = useLocation();
  const save = useSaveBlocks(roomId, section.id);
  const roomGroups = useMainItems(roomId, true).data ?? [];
  const openedNew = (location.state as OpenInEditState | null)?.landingEdit === 'add-block' && section.blocks.length === 0;
  const [adding, setAdding] = useState<number | null>(openedNew ? 0 : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The block whose groups popover is open, by position: a save gives every
  // block a new id, so its bar remounts and reopens it (spec 55 Decision 15).
  const [groupsOpen, setGroupsOpen] = useState<number | null>(null);
  const blocks = section.blocks;

  const saveList = (next: BlockInput[], onDone?: () => void) =>
    save.mutate(next, { onError: notifyError, onSuccess: () => onDone?.() });
  const inputs = () => blocks.map(blockInput);

  const insert = (index: number, kind: BlockKind) => {
    setAdding(null);
    const block: BlockInput = { kind, heading: null, tagIds: [], groups: [], mapKind: null, features: [] };
    if (kind === 'maps') {
      const next = inputs();
      next.splice(index, 0, block);
      saveList(next);
    } else {
      setDraft({ index, block });
    }
  };
  // A draft's bar changes only through its open picker (closing it drops
  // the draft), so its first change is its first Tag or feature.
  const saveDraft = (at: Draft, block: BlockInput) => {
    const next = inputs();
    next.splice(at.index, 0, block);
    setDraft(null);
    saveList(next);
  };
  const remove = (index: number) => {
    const before = inputs();
    saveList(
      before.filter((_, other) => other !== index),
      () =>
        notifications.show({
          autoClose: UNDO_MS,
          message: (
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm">{t('roomLanding.edit.blockDeleted')}</Text>
              <Button size="compact-xs" variant="light" onClick={() => saveList(before)}>
                {t('roomLanding.edit.undo')}
              </Button>
            </Group>
          ),
        }),
    );
  };
  const change = (index: number, block: BlockInput) => {
    const next = inputs();
    next[index] = block;
    saveList(next);
  };
  const move = (ids: string[]) => {
    const byId = new Map(blocks.map((block) => [block.id, block]));
    saveList(ids.map((id) => blockInput(byId.get(id)!)));
  };

  const dropDraft = () => setDraft(null);
  const full = blocks.length >= MAX_BLOCKS;
  const draftView = draft && (
    <Stack gap="sm" className="room-landing-block room-landing-draft">
      <BlockBar
        block={draft.block}
        tags={sources.tags}
        mainItems={roomGroups}
        initialPicker={draft.block.kind === 'documents' ? 'tags' : 'features'}
        onChange={(block) => saveDraft(draft, block)}
        onDelete={dropDraft}
        onCancelDraft={dropDraft}
      />
    </Stack>
  );

  return (
    <Stack gap="xl" className="room-landing-editing">
      {blocks.length === 0 && !draft && (
        <Text c="dimmed" size="sm">
          {t('roomLanding.edit.noBlocks')}
        </Text>
      )}
      <SortableList ids={blocks.map((block) => block.id)} onMove={move}>
        {blocks.map((block, index) => (
          <Box key={block.id}>
            {index > 0 && !full && (
              <AddBlock
                compact
                opened={adding === index}
                onOpen={() => setAdding(index)}
                onClose={() => setAdding(null)}
                onPick={(kind) => insert(index, kind)}
              />
            )}
            {draft?.index === index && draftView}
            <SortableItem id={block.id}>
              {({ ref, style }) => (
                <div ref={ref} style={style}>
                  <EditableBlock
                    roomId={roomId}
                    block={block}
                    sources={sources}
                    bar={
                      <BlockBar
                        block={blockInput(block)}
                        tags={sources.tags}
                        mainItems={roomGroups}
                        onChange={(next) => change(index, next)}
                        onDelete={() => remove(index)}
                        initialPicker={groupsOpen === index ? 'groups' : null}
                        onGroupsOpenChange={(open) => setGroupsOpen(open ? index : null)}
                      />
                    }
                    onReorderParts={(next) => change(index, next)}
                  />
                </div>
              )}
            </SortableItem>
          </Box>
        ))}
      </SortableList>
      {draft && draft.index >= blocks.length && draftView}
      {!full && (
        <AddBlock
          opened={adding === blocks.length}
          onOpen={() => setAdding(blocks.length)}
          onClose={() => setAdding(null)}
          onPick={(kind) => insert(blocks.length, kind)}
        />
      )}
    </Stack>
  );
}

/**
 * A block in edit mode: its bar, then its real cards, its groups or
 * features dragged by their heading (the same order as the chips; "Altri
 * documenti" stays last).
 */
function EditableBlock({
  roomId,
  block,
  sources,
  bar,
  onReorderParts,
}: {
  roomId: string;
  block: LandingBlock;
  sources: BlockSources;
  bar: ReactNode;
  onReorderParts: (block: BlockInput) => void;
}) {
  const { t } = useTranslation();
  const content = blockContent(block, sources);
  const groupKey = (group: string[]) => group.filter((id) => sources.tags.some((tag) => tag.id === id)).join('+');
  const movable = (key: string) => key !== 'ungrouped' && key !== 'all';

  // The visible sub-sections in their new order fill the slots the visible
  // ones held; the empty ones, not on screen, keep theirs.
  const reorder = (visible: string[]) => {
    if (block.kind === 'documents') {
      const keys = block.groups.map(groupKey);
      const slots = keys.map((key, index) => (visible.includes(key) ? index : -1)).filter((index) => index >= 0);
      const next = [...block.groups];
      const order = visible.filter(movable);
      slots.forEach((slot, n) => {
        next[slot] = block.groups[keys.indexOf(order[n])];
      });
      onReorderParts({ ...blockInput(block), groups: next });
    } else {
      const slots = block.features.map((feature, index) => (visible.includes(feature) ? index : -1)).filter((index) => index >= 0);
      const next = [...block.features];
      slots.forEach((slot, n) => {
        next[slot] = visible[n] as SessionZeroFeature;
      });
      onReorderParts({ ...blockInput(block), features: next });
    }
  };

  return (
    <SectionBlock
      roomId={roomId}
      block={block}
      heading={blockHeading(block, sources.tags)}
      content={content}
      isMaster
      bar={bar}
      partHandle={(key) => (movable(key) ? <DragHandle size="xs" label={t('roomLanding.edit.dragPart')} /> : null)}
      wrapParts={(parts, keys) => (
        <SortableList ids={keys.filter(movable)} onMove={reorder}>
          {parts.map((part, index) =>
            movable(keys[index]) ? (
              <SortableItem key={keys[index]} id={keys[index]}>
                {({ ref, style }) => (
                  <div ref={ref} style={style}>
                    {part}
                  </div>
                )}
              </SortableItem>
            ) : (
              <Box key={keys[index]}>{part}</Box>
            ),
          )}
        </SortableList>
      )}
    />
  );
}

/**
 * "+ Blocco" (spec 55 Decision 14): a dashed bar after the last block, or
 * a small "+" between two that shows on hover or focus, opening the three
 * tiles (one column on a phone, where it is a bottom sheet).
 */
function AddBlock({
  compact = false,
  opened,
  onOpen,
  onClose,
  onPick,
}: {
  compact?: boolean;
  opened: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (kind: BlockKind) => void;
}) {
  const { t } = useTranslation();
  const target = compact ? (
    <UnstyledButton className="room-landing-insert" onClick={onOpen} aria-label={t('roomLanding.edit.insertBlock')}>
      <PlusIcon size={14} aria-hidden="true" />
    </UnstyledButton>
  ) : (
    <UnstyledButton className="room-landing-add" onClick={onOpen}>
      <Group gap={6} justify="center">
        <PlusIcon size={16} aria-hidden="true" />
        <Text size="sm">{t('roomLanding.edit.addBlock')}</Text>
      </Group>
    </UnstyledButton>
  );
  return (
    <Picker opened={opened} onClose={onClose} title={t('roomLanding.edit.addBlockTitle')} target={target} width={480}>
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
        {(['documents', 'maps', 'session_zero'] as const).map((kind) => (
          <UnstyledButton key={kind} className="room-landing-tile" onClick={() => onPick(kind)}>
            <Stack gap={4} align="flex-start">
              <BlockKindIcon kind={kind} size={22} />
              <Text fw={600} size="sm">
                {t(`roomLanding.tiles.${kind}.title`)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(`roomLanding.tiles.${kind}.body`)}
              </Text>
            </Stack>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </Picker>
  );
}

