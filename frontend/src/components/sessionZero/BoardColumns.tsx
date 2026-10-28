import { Fragment, useCallback, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Box, Button, Group, Menu, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { DotsThreeVerticalIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { MAX_COLUMN_TITLE_LENGTH, MAX_RETRO_COLUMNS, boardWrites, columnColor } from '../../lib/sessionZero';
import { columnItems, dragKey, showsLine } from '../../lib/sessionZeroDnd';
import type { MapColor } from '../../types/map';
import type { PostItColumn } from '../../types/sessionZero';
import { MapColorPicker } from '../maps/MapColorPicker';
import { DropLine } from './BoardDnd';
import { useDndState, type DropData } from './boardDrag';
import { PostItCard } from './PostItCard';
import { PostItGroup } from './PostItGroup';
import { PostItEditor } from './PostItEditor';
import { useBoard } from './boardContext';

/**
 * The width of the "Add column" form. Columns themselves fit the board
 * (spec 46c Decision 11, `.sz-retro-column` in `index.css`): Retro ones share
 * its width, at least 220px each (a phone's width on a phone), and the
 * board scrolls sideways past that.
 */
export const COLUMN_WIDTH = 260;

interface ColumnFrameProps {
  /** The column's id: it glows when another member changes it (spec 46_4). */
  id: string;
  title: ReactNode;
  /** Its colour: a band on top, a light tint (spec 46c Decision 5). */
  color: string;
  menu?: ReactNode;
  /** A Retro post-it dragged over this Lines & Veils row would be promoted here. */
  dropOver?: boolean;
  /** A Lines & Veils row: the whole width, its band on the left (spec 46c Decision 11). */
  fill?: boolean;
  /** The column being dragged by its heading (spec 46d Decision 7): it stays in place, faded. */
  dragging?: boolean;
  /** The heading's drag handle, for the Master's columns. */
  handleProps?: HTMLAttributes<HTMLHeadingElement> & { ref?: (node: HTMLHeadingElement | null) => void };
  /** The node a column dragged by its heading moves (spec 46d Decision 7). */
  frameRef?: (node: HTMLElement | null) => void;
  children: ReactNode;
}

/**
 * A column's frame: heading, its menu, the post-its. It is where a dragged
 * post-it lands last in it (spec 46d Decision 7) and, on Lines & Veils,
 * where a Retro one is promoted.
 */
function ColumnFrame({
  id,
  title,
  color,
  menu,
  dropOver = false,
  fill = false,
  dragging = false,
  handleProps,
  frameRef,
  children,
}: ColumnFrameProps) {
  const { glowing } = useBoard();
  const key = dragKey({ kind: 'column', id });
  const data: DropData = { ref: { kind: 'column', id }, axis: 'x' };
  const { setNodeRef } = useDroppable({ id: key, data });
  const nodeRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      frameRef?.(node);
    },
    [setNodeRef, frameRef],
  );
  return (
    <Paper
      ref={nodeRef}
      withBorder
      radius="md"
      p="xs"
      w={fill ? '100%' : undefined}
      className={fill ? 'sz-column sz-lines-veils-row' : 'sz-column sz-retro-column'}
      data-drop-over={dropOver || undefined}
      data-glow={glowing.has(id) || undefined}
      data-dragging={dragging || undefined}
      style={
        {
          '--sz-color': color,
          borderColor: dropOver ? 'var(--accent-primary)' : undefined,
          alignSelf: 'flex-start',
        } as CSSProperties
      }
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap={4}>
          <Title
            order={2}
            fz="md"
            fw={700}
            ff="var(--font-display)"
            style={{ overflowWrap: 'anywhere', flex: 1 }}
            {...handleProps}
          >
            {title}
          </Title>
          {menu}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

interface RetroColumnProps {
  column: PostItColumn;
  index: number;
  count: number;
  /** The round shown is open: post-its can be written, columns managed. */
  open: boolean;
}

/**
 * A column of the Retro board: its post-its, related ones framed together in
 * their groups (spec 46c Decision 9), in their order (spec 46d Decision 7),
 * and, in the open round, "Add post-it" for every member. The Master
 * renames, recolours, moves and deletes it (spec 46 Decision 10, 46c
 * Decision 5), and drags it by its heading; deleting asks first, since its
 * post-its go too. A dragged post-it or group shows a line where it lands.
 * The Stars and Wishes columns are fixed (spec 47 Decision 7): their names
 * are the app's, in the viewer's language, and the Master has no menu.
 */
export function RetroColumn({ column, index, count, open }: RetroColumnProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const { intent } = useDndState();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [title, setTitle] = useState(column.title);
  const fixed = column.kind !== null;
  const manage = writable && open && board.canManage && !fixed;
  const draggable = useDraggable({ id: dragKey({ kind: 'column', id: column.id }), disabled: !manage || renaming });
  // The pointer drags the column; keyboard users have "Move left / right" in its menu.
  const { onKeyDown: _keyboard, ...pointerListeners } = draggable.listeners ?? {};
  const ids = board.retro.map((other) => other.id);
  const moveTo = (to: number) => {
    const order = ids.filter((id) => id !== column.id);
    order.splice(to, 0, column.id);
    act(boardWrites.reorderColumns(order));
  };

  // Focus stays on the rename field rather than going back to the "⋮".
  const menu = manage && (
    <Menu position="bottom-end" shadow="md" returnFocus={false}>
      <Menu.Target>
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={t('sessionZero.columns.actions', { title: column.title })}
        >
          <DotsThreeVerticalIcon size={18} />
        </LabeledActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={() => {
            setTitle(column.title);
            setRenaming(true);
          }}
        >
          {t('sessionZero.columns.rename')}
        </Menu.Item>
        <Menu.Item onClick={() => setRecoloring(true)}>{t('sessionZero.columns.color')}</Menu.Item>
        {index > 0 && <Menu.Item onClick={() => moveTo(index - 1)}>{t('sessionZero.columns.moveLeft')}</Menu.Item>}
        {index < count - 1 && (
          <Menu.Item onClick={() => moveTo(index + 1)}>{t('sessionZero.columns.moveRight')}</Menu.Item>
        )}
        <Menu.Item color="red" onClick={() => setDeleting(true)}>
          {t('common.delete')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <ColumnFrame
      id={column.id}
      title={
        renaming ? (
          <TextInput
            size="xs"
            aria-label={t('sessionZero.columns.title')}
            value={title}
            maxLength={MAX_COLUMN_TITLE_LENGTH}
            autoFocus
            onChange={(event) => setTitle(event.currentTarget.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false);
              if (event.key === 'Enter' && title.trim()) {
                act(boardWrites.renameColumn(column.id, title.trim()));
                setRenaming(false);
              }
            }}
          />
        ) : fixed ? (
          t(`sessionZero.kinds.${column.kind!}`)
        ) : (
          column.title
        )
      }
      color={columnColor(column)}
      menu={menu}
      dragging={draggable.isDragging}
      frameRef={draggable.setNodeRef}
      handleProps={
        manage && !renaming
          ? { ...pointerListeners, ref: draggable.setActivatorNodeRef, style: { cursor: 'grab', userSelect: 'none' } }
          : undefined
      }
    >
      {columnItems(column).map((item) => {
        const id = item.kind === 'card' ? item.card.id : item.group.id;
        return (
          <Fragment key={id}>
            {showsLine(intent, column.id, null, id) && <DropLine />}
            {item.kind === 'card' ? (
              <PostItCard postIt={item.card} column={column} onLinesVeils={false} />
            ) : (
              <PostItGroup groupId={item.group.id} column={column} cards={item.cards} open={open} />
            )}
          </Fragment>
        );
      })}
      {showsLine(intent, column.id, null, null) && <DropLine />}
      {writable && open && !adding && (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<PlusIcon size={16} />}
          onClick={() => setAdding(true)}
        >
          {t('sessionZero.postIt.add')}
        </Button>
      )}
      {adding && (
        <PostItEditor
          submitLabel={t('sessionZero.postIt.saveDraft')}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(body) => {
            act(boardWrites.addPostIt(column.id, body));
            setAdding(false);
          }}
        />
      )}
      {recoloring && (
        <Modal opened onClose={() => setRecoloring(false)} title={t('sessionZero.columns.color')} centered>
          <MapColorPicker
            value={column.color}
            onChange={(color) => act(boardWrites.recolorColumn(column.id, color), () => setRecoloring(false))}
          />
        </Modal>
      )}
      {deleting && (
        <Modal opened onClose={() => setDeleting(false)} title={t('sessionZero.columns.deleteTitle')} centered>
          <Stack>
            <Text size="sm">{t('sessionZero.columns.deleteBody', { title: column.title })}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleting(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                disabled={busy}
                onClick={() => {
                  act(boardWrites.deleteColumn(column.id));
                  setDeleting(false);
                }}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </ColumnFrame>
  );
}

/**
 * The post-it board of the step on screen, a Retro or a Stars and Wishes one
 * (spec 47), its columns side by side, scrolling sideways; a column dragged
 * by the Master shows where it lands (spec 46d Decision 7). Only a Retro
 * step takes new columns.
 */
export function RetroBoard() {
  const { t } = useTranslation();
  const { board, module, writable } = useBoard();
  const starsWishes = module?.kind === 'stars_wishes';
  const { intent } = useDndState();
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  const lineBefore = (id: string | null) => intent?.kind === 'column' && intent.beforeId === id;
  return (
    <Box
      component="section"
      aria-label={starsWishes ? t('sessionZero.modules.kinds.stars_wishes') : t('sessionZero.retro.title')}
      className="sz-retro-scroll"
      pb="xs"
    >
      <Group align="flex-start" wrap="nowrap" gap="sm">
        {board.retro.map((column, index) => (
          <Fragment key={column.id}>
            {lineBefore(column.id) && <DropLine axis="x" />}
            <RetroColumn column={column} index={index} count={board.retro.length} open={open} />
          </Fragment>
        ))}
        {lineBefore(null) && <DropLine axis="x" />}
        {writable && open && board.canManage && !starsWishes && board.retro.length < MAX_RETRO_COLUMNS && (
          <AddColumn />
        )}
      </Group>
    </Box>
  );
}

/**
 * A Lines & Veils column (Must, Veils or Lines, spec 46 Decision 10), drawn
 * as a row: the board's full width, the three one under the other, green,
 * gold and red (spec 46c Decisions 5 and 11), its post-its side by side. For
 * the Master it is a drop target: a Retro post-it dropped here is promoted
 * as a copy (Decisions 2 and 8), a Lines & Veils one lands where the line
 * shows, in this row or another (Decision 16, spec 46d Decision 7); and the
 * Master writes in it directly, published at once (spec 46c Decision 6).
 */
export function LinesVeilsColumn({ column }: { column: PostItColumn }) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const { intent } = useDndState();
  const [adding, setAdding] = useState(false);
  const manage = writable && board.canManage;
  return (
    <ColumnFrame
      id={column.id}
      title={t(`sessionZero.kinds.${column.kind!}`)}
      color={columnColor(column)}
      fill
      dropOver={intent?.kind === 'promote' && intent.columnId === column.id}
    >
      {column.cards.length === 0 && !adding && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.linesVeils.empty')}
        </Text>
      )}
      {column.cards.length > 0 && (
        <div className="sz-lines-veils-cards">
          {column.cards.map((postIt, index) => (
            <div key={postIt.id} className="sz-lv-slot">
              {showsLine(intent, column.id, null, postIt.id) && <DropLine axis="x" />}
              <PostItCard postIt={postIt} column={column} onLinesVeils />
              {index === column.cards.length - 1 && showsLine(intent, column.id, null, null) && (
                <DropLine axis="x" end />
              )}
            </div>
          ))}
        </div>
      )}
      {manage && !adding && (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<PlusIcon size={16} />}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setAdding(true)}
        >
          {t('sessionZero.linesVeils.add')}
        </Button>
      )}
      {adding && (
        <PostItEditor
          submitLabel={t('common.add')}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(body) => act(boardWrites.addPostIt(column.id, body), () => setAdding(false))}
        />
      )}
    </ColumnFrame>
  );
}

/**
 * The Master's "Add column" at the end of the Retro step on screen
 * (Decision 10, at most 8), in the colour they pick (spec 46c Decision 5).
 */
export function AddColumn() {
  const { t } = useTranslation();
  const { module, act, busy } = useBoard();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<MapColor>('default');
  const add = () => {
    act(boardWrites.addColumn(title.trim(), color, module?.id ?? null));
    setAdding(false);
    setTitle('');
    setColor('default');
  };
  if (!adding) {
    return (
      <LabeledActionIcon
        variant="default"
        size="md"
        aria-label={t('sessionZero.columns.add')}
        style={{ alignSelf: 'flex-start', flexShrink: 0 }}
        onClick={() => setAdding(true)}
      >
        <PlusIcon size={18} />
      </LabeledActionIcon>
    );
  }
  return (
    <Paper withBorder radius="md" p="xs" w={COLUMN_WIDTH} miw={COLUMN_WIDTH} style={{ alignSelf: 'flex-start' }}>
      <Stack gap={4}>
        <TextInput
          size="xs"
          aria-label={t('sessionZero.columns.title')}
          value={title}
          maxLength={MAX_COLUMN_TITLE_LENGTH}
          autoFocus
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setAdding(false);
            if (event.key === 'Enter' && title.trim()) add();
          }}
        />
        <MapColorPicker value={color} onChange={setColor} />
        <Group gap={4} justify="flex-end">
          <Button size="compact-sm" variant="default" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="compact-sm" disabled={!title.trim() || busy} onClick={add}>
            {t('common.add')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
