import { useState, type CSSProperties } from 'react';
import { Group, Menu, Stack, Text, TextInput } from '@mantine/core';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { MAX_GROUP_TITLE_LENGTH, boardWrites, columnColor } from '../../lib/sessionZero';
import type { PostIt, PostItColumn } from '../../types/sessionZero';
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
 * The Master titles the group or dissolves it ("Ungroup all").
 */
export function PostItGroup({ groupId, column, cards, open }: PostItGroupProps) {
  const { t } = useTranslation();
  const { board, act, writable } = useBoard();
  const [renaming, setRenaming] = useState(false);
  const group = column.groups.find((g) => g.id === groupId);
  const [title, setTitle] = useState(group?.title ?? '');
  const manage = writable && open && board.canManage;
  const shownTitle = group?.title ?? t('sessionZero.groups.untitled');

  return (
    <Stack
      gap={6}
      p={6}
      className="sz-group"
      role="group"
      aria-label={shownTitle}
      style={{ '--sz-color': columnColor(column) } as CSSProperties}
    >
      <Group justify="space-between" wrap="nowrap" gap={4}>
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
        <PostItCard key={postIt.id} postIt={postIt} column={column} onLinesVeils={false} />
      ))}
    </Stack>
  );
}
