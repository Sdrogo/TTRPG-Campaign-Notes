import { Fragment, useCallback, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Badge, Group, Menu, Stack, Text, TextInput } from '@mantine/core';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { MAX_GROUP_TITLE_LENGTH, boardWrites, columnColor } from '../../lib/sessionZero';
import { dragKey, showsLine } from '../../lib/sessionZeroDnd';
import type { PostIt, PostItColumn } from '../../types/sessionZero';
import { DropLine } from './BoardDnd';
import { useDndState, type DropData } from './boardDrag';
import { PostItCard } from './PostItCard';
import { useBoard } from './boardContext';

interface PostItGroupProps {
  groupId: string;
  column: PostItColumn;
  cards: PostIt[];
  /** The round shown is open: the Master manages the group. */
  open: boolean;
}

/**
 * Related post-its of a Retro column, framed together (spec 46c Decision
 * 9): the group's title ("Group" when it has none) and how many post-its it
 * holds, then each post-it with its own text, author, reactions and actions.
 * The Master titles the group or dissolves it ("Ungroup all"), and drags it
 * by its heading, as one block (spec 46d Decision 7). A post-it dragged onto
 * it shows the group's ring and "Group"; between its post-its, a line.
 */
export function PostItGroup({ groupId, column, cards, open }: PostItGroupProps) {
  const { t } = useTranslation();
  const { board, act, writable, glowing } = useBoard();
  const { intent } = useDndState();
  const [renaming, setRenaming] = useState(false);
  const group = column.groups.find((g) => g.id === groupId);
  const [title, setTitle] = useState(group?.title ?? '');
  const manage = writable && open && board.canManage;
  const shownTitle = group?.title ?? t('sessionZero.groups.untitled');
  const key = dragKey({ kind: 'group', id: groupId });
  const draggable = useDraggable({ id: key, disabled: !manage || renaming });
  const data: DropData = { ref: { kind: 'group', id: groupId }, axis: 'y' };
  const droppable = useDroppable({ id: key, data });
  const { setNodeRef: setDragRef } = draggable;
  const { setNodeRef: setDropRef } = droppable;
  const nodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  const joining = intent?.kind === 'place' && intent.join === true && intent.groupId === groupId;
  const { onKeyDown, ...pointerListeners } = draggable.listeners ?? {};
  const handleProps =
    manage && !renaming
      ? {
          ...pointerListeners,
          ref: draggable.setActivatorNodeRef,
          tabIndex: 0,
          'aria-describedby': draggable.attributes['aria-describedby'],
          onKeyDown: (event: KeyboardEvent) => {
            if (event.target === event.currentTarget) onKeyDown?.(event);
          },
          style: { cursor: 'grab', userSelect: 'none' as const },
        }
      : {};

  return (
    <Stack
      ref={nodeRef}
      gap={6}
      p={6}
      className="sz-group"
      data-glow={glowing.has(groupId) || undefined}
      data-group-target={joining || undefined}
      data-dragging={draggable.isDragging || undefined}
      role="group"
      aria-label={shownTitle}
      style={{ '--sz-color': columnColor(column) } as CSSProperties}
    >
      {joining && (
        <Badge size="sm" className="sz-group-here">
          {t('sessionZero.dnd.groupHere')}
        </Badge>
      )}
      <Group justify="space-between" wrap="nowrap" gap={4} {...handleProps}>
        {renaming ? (
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            aria-label={t('sessionZero.groups.title')}
            value={title}
            maxLength={MAX_GROUP_TITLE_LENGTH}
            autoFocus
            onChange={(event) => setTitle(event.currentTarget.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false);
              if (event.key === 'Enter') {
                act(boardWrites.renameGroup(groupId, title));
                setRenaming(false);
              }
            }}
          />
        ) : (
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text size="xs" fw={700} truncate>
              {shownTitle}
            </Text>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {t('sessionZero.groups.count', { count: cards.length })}
            </Text>
          </Group>
        )}
        {manage && (
          <Menu position="bottom-end" shadow="md" returnFocus={false}>
            <Menu.Target>
              <LabeledActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t('sessionZero.groups.actions', { title: shownTitle })}
              >
                <DotsThreeVerticalIcon size={16} />
              </LabeledActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() => {
                  setTitle(group?.title ?? '');
                  setRenaming(true);
                }}
              >
                {t('sessionZero.groups.rename')}
              </Menu.Item>
              <Menu.Item onClick={() => act(boardWrites.ungroupAll(groupId))}>
                {t('sessionZero.groups.ungroupAll')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {cards.map((postIt) => (
        <Fragment key={postIt.id}>
          {showsLine(intent, column.id, groupId, postIt.id) && <DropLine />}
          <PostItCard postIt={postIt} column={column} onLinesVeils={false} />
        </Fragment>
      ))}
      {showsLine(intent, column.id, groupId, null) && <DropLine />}
    </Stack>
  );
}
