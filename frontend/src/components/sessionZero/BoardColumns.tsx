import { useState, type DragEvent, type ReactNode } from 'react';
import { Button, Group, Menu, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { DotsThreeVerticalIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { MAX_COLUMN_TITLE_LENGTH, POST_IT_DRAG_TYPE, boardWrites, type DraggedPostIt } from '../../lib/sessionZero';
import type { PostItColumn } from '../../types/sessionZero';
import { PostItCard } from './PostItCard';
import { PostItEditor } from './PostItEditor';
import { useBoard } from './boardContext';

/** A column's width on the boards; the Retro board scrolls sideways past the screen. */
export const COLUMN_WIDTH = 260;

interface ColumnFrameProps {
  title: ReactNode;
  menu?: ReactNode;
  dropTarget?: boolean;
  onDrop?: (dragged: DraggedPostIt) => void;
  /** Takes the whole width (Lines & Veils columns sit one under the other). */
  fill?: boolean;
  children: ReactNode;
}

/** A column's frame: heading, its menu, the post-its, and (on Lines & Veils) a drop target. */
function ColumnFrame({ title, menu, dropTarget = false, onDrop, fill = false, children }: ColumnFrameProps) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => dropTarget && event.dataTransfer.types.includes(POST_IT_DRAG_TYPE);
  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      w={fill ? '100%' : COLUMN_WIDTH}
      miw={fill ? undefined : COLUMN_WIDTH}
      data-drop-over={over || undefined}
      style={{ borderColor: over ? 'var(--accent-primary)' : undefined, alignSelf: 'flex-start' }}
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
 * A column of the Retro board: its post-its and, in the open round, "Add
 * post-it" for every member. The Master renames, moves and deletes it
 * (spec 46 Decision 10); deleting asks first, since its post-its go too.
 */
export function RetroColumn({ column, index, count, open }: RetroColumnProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      menu={menu}
    >
      {column.cards.map((postIt) => (
        <PostItCard key={postIt.id} postIt={postIt} onLinesVeils={false} />
      ))}
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
 * A Lines & Veils column (Must, Lines or Veils, spec 46 Decision 10), the
 * board's full width, the three one under the other. For the
 * Master it is a drop target: a Retro post-it dropped here is promoted as a
 * copy, a Lines & Veils one is moved here (Decisions 2, 8 and 16).
 */
export function LinesVeilsColumn({ column }: { column: PostItColumn }) {
  const { t } = useTranslation();
  const { board, act, writable } = useBoard();
  return (
    <ColumnFrame
      title={t(`sessionZero.kinds.${column.kind!}`)}
      fill
      dropTarget={writable && board.canManage}
      onDrop={(dragged) => {
        if (dragged.action === 'promote') act(boardWrites.promote(dragged.id, column.id));
        else if (dragged.columnId !== column.id) act(boardWrites.move(dragged.id, column.id));
      }}
    >
      {column.cards.length === 0 && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.linesVeils.empty')}
        </Text>
      )}
      {column.cards.map((postIt) => (
        <PostItCard key={postIt.id} postIt={postIt} onLinesVeils />
      ))}
    </ColumnFrame>
  );
}

/** The Master's "Add column" at the end of the open round's Retro board (Decision 10, at most 8). */
export function AddColumn() {
  const { t } = useTranslation();
  const { act, busy } = useBoard();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const add = () => {
    act(boardWrites.addColumn(title.trim()));
    setAdding(false);
    setTitle('');
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
