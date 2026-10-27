import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { Button, Group, Menu, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { DotsThreeVerticalIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import {
  MAX_COLUMN_TITLE_LENGTH,
  POST_IT_DRAG_TYPE,
  boardWrites,
  columnColor,
  type DraggedPostIt,
} from '../../lib/sessionZero';
import type { MapColor } from '../../types/map';
import type { PostIt, PostItColumn } from '../../types/sessionZero';
import { MapColorPicker } from '../maps/MapColorPicker';
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
  title: ReactNode;
  /** Its colour: a band on top, a light tint (spec 46c Decision 5). */
  color: string;
  menu?: ReactNode;
  dropTarget?: boolean;
  onDrop?: (dragged: DraggedPostIt) => void;
  /** A Lines & Veils row: the whole width, its band on the left (spec 46c Decision 11). */
  fill?: boolean;
  children: ReactNode;
}

/** A column's frame: heading, its menu, the post-its, and (on Lines & Veils) a drop target. */
function ColumnFrame({ title, color, menu, dropTarget = false, onDrop, fill = false, children }: ColumnFrameProps) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => dropTarget && event.dataTransfer.types.includes(POST_IT_DRAG_TYPE);
  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      w={fill ? '100%' : undefined}
      className={fill ? 'sz-column sz-lines-veils-row' : 'sz-column sz-retro-column'}
      data-drop-over={over || undefined}
      style={
        {
          '--sz-color': color,
          borderColor: over ? 'var(--accent-primary)' : undefined,
          alignSelf: 'flex-start',
        } as CSSProperties
      }
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        onDrop!(JSON.parse(event.dataTransfer.getData(POST_IT_DRAG_TYPE)) as DraggedPostIt);
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap={4}>
          <Title order={3} fz="sm" style={{ overflowWrap: 'anywhere' }}>
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
 * their groups (spec 46c Decision 9), and, in the open round, "Add post-it"
 * for every member. The Master renames, recolours, moves and deletes it
 * (spec 46 Decision 10, 46c Decision 5); deleting asks first, since its
 * post-its go too.
 */
export function RetroColumn({ column, index, count, open }: RetroColumnProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [title, setTitle] = useState(column.title);
  const manage = writable && open && board.canManage;
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
          <DotsThreeVerticalIcon size={16} />
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
        ) : (
          column.title
        )
      }
      color={columnColor(column)}
      menu={menu}
    >
      {stacks(column).map((stack) =>
        stack.groupId === null ? (
          <PostItCard key={stack.cards[0].id} postIt={stack.cards[0]} column={column} onLinesVeils={false} />
        ) : (
          <PostItGroup key={stack.groupId} groupId={stack.groupId} column={column} cards={stack.cards} open={open} />
        ),
      )}
      {writable && open && !adding && (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<PlusIcon size={14} />}
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

/** A lone post-it, or a group's post-its, in the column's order. */
interface CardStack {
  groupId: string | null;
  cards: PostIt[];
}

/** The column's post-its in order, a group standing where its first post-it does. */
function stacks(column: PostItColumn): CardStack[] {
  const result: CardStack[] = [];
  const groups = new Map<string, CardStack>();
  for (const card of column.cards) {
    if (card.groupId === null) {
      result.push({ groupId: null, cards: [card] });
      continue;
    }
    const stack = groups.get(card.groupId);
    if (stack) {
      stack.cards.push(card);
    } else {
      const created = { groupId: card.groupId, cards: [card] };
      groups.set(card.groupId, created);
      result.push(created);
    }
  }
  return result;
}

/**
 * A Lines & Veils column (Must, Veils or Lines, spec 46 Decision 10), drawn
 * as a row: the board's full width, the three one under the other, green,
 * gold and red (spec 46c Decisions 5 and 11), its post-its side by side. For the Master it is a drop target: a Retro
 * post-it dropped here is promoted as a copy, a Lines & Veils one is moved
 * here (Decisions 2, 8 and 16); and the Master writes in it directly,
 * published at once (spec 46c Decision 6).
 */
export function LinesVeilsColumn({ column }: { column: PostItColumn }) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [adding, setAdding] = useState(false);
  const manage = writable && board.canManage;
  return (
    <ColumnFrame
      title={t(`sessionZero.kinds.${column.kind!}`)}
      color={columnColor(column)}
      fill
      dropTarget={manage}
      onDrop={(dragged) => {
        if (dragged.action === 'promote') act(boardWrites.promote(dragged.id, column.id));
        else if (dragged.columnId !== column.id) act(boardWrites.move(dragged.id, column.id));
      }}
    >
      {column.cards.length === 0 && !adding && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.linesVeils.empty')}
        </Text>
      )}
      {column.cards.length > 0 && (
        <div className="sz-lines-veils-cards">
          {column.cards.map((postIt) => (
            <PostItCard key={postIt.id} postIt={postIt} column={column} onLinesVeils />
          ))}
        </div>
      )}
      {manage && !adding && (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<PlusIcon size={14} />}
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
 * The Master's "Add column" at the end of the open round's Retro board
 * (Decision 10, at most 8), in the colour they pick (spec 46c Decision 5).
 */
export function AddColumn() {
  const { t } = useTranslation();
  const { act, busy } = useBoard();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<MapColor>('default');
  const add = () => {
    act(boardWrites.addColumn(title.trim(), color));
    setAdding(false);
    setTitle('');
    setColor('default');
  };
  if (!adding) {
    return (
      <Button
        variant="default"
        leftSection={<PlusIcon size={14} />}
        miw={COLUMN_WIDTH / 2}
        style={{ alignSelf: 'flex-start', flexShrink: 0 }}
        onClick={() => setAdding(true)}
      >
        {t('sessionZero.columns.add')}
      </Button>
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
