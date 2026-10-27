import { useState, type DragEvent } from 'react';
import { Badge, Button, Group, Menu, Modal, Paper, Stack, Switch, Text } from '@mantine/core';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AddReaction, ReactionChips } from '../comments/CommentReactions';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import { POST_IT_DRAG_TYPE, boardWrites, type DraggedPostIt } from '../../lib/sessionZero';
import type { PostIt } from '../../types/sessionZero';
import { PostItEditor } from './PostItEditor';
import { useBoard } from './boardContext';

interface PostItCardProps {
  postIt: PostIt;
  /** On the Lines & Veils board: the Master moves it, a Retro one is promoted. */
  onLinesVeils: boolean;
}

/**
 * One post-it (spec 46 Design 46_3): its text, who wrote it ("Anonymous" for
 * someone else's anonymous one), a "Draft" or "from the Retro" badge, the
 * reactions, and a "⋮" with what the backend allows the viewer: publish,
 * edit, promote to or move between Must / Lines / Veils, delete. The Master
 * can also drag it onto a Lines & Veils column.
 */
export function PostItCard({ postIt, onLinesVeils }: PostItCardProps) {
  const { t } = useTranslation();
  const { board, members, act, busy, writable } = useBoard();
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const canEdit = writable && postIt.canEdit;
  const canDelete = writable && postIt.canDelete;
  const canPublish = writable && postIt.canPublish;
  const canPromote = writable && postIt.canPromote;
  const canMove = writable && postIt.canMove;
  const canReact = writable && postIt.canReact;
  const targets = board.linesVeils.filter((column) => !(canMove && column.id === postIt.columnId));
  const hasMenu = canEdit || canDelete || canPublish || canPromote || canMove;

  const author =
    postIt.authorId === null
      ? t('sessionZero.postIt.anonymous')
      : postIt.mine
        ? t('common.you')
        : displayNameFor(members, postIt.authorId);

  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    const dragged: DraggedPostIt = {
      id: postIt.id,
      action: onLinesVeils ? 'move' : 'promote',
      columnId: postIt.columnId,
    };
    event.dataTransfer.setData(POST_IT_DRAG_TYPE, JSON.stringify(dragged));
    event.dataTransfer.effectAllowed = onLinesVeils ? 'move' : 'copy';
  };

  if (editing) {
    return (
      <Paper withBorder radius="sm" p="xs">
        <PostItEditor
          initial={postIt.body}
          submitLabel={t('common.save')}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            act(boardWrites.editPostIt(postIt.id, body));
            setEditing(false);
          }}
        />
      </Paper>
    );
  }

  return (
    <Paper
      withBorder
      radius="sm"
      p="xs"
      draggable={canPromote || canMove}
      onDragStart={onDragStart}
      aria-label={t('sessionZero.postIt.label', { author })}
      role="article"
      style={{
        borderStyle: postIt.draft ? 'dashed' : undefined,
        cursor: canPromote || canMove ? 'grab' : undefined,
        background: 'var(--bg-raised)',
      }}
    >
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {postIt.body}
          </Text>
          {hasMenu && (
            <Menu position="bottom-end" shadow="md">
              <Menu.Target>
                <LabeledActionIcon variant="subtle" color="gray" size="sm" aria-label={t('sessionZero.postIt.actions')}>
                  <DotsThreeVerticalIcon size={16} />
                </LabeledActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canPublish && (
                  <Menu.Item onClick={() => setPublishing(true)}>{t('sessionZero.postIt.publish')}</Menu.Item>
                )}
                {canEdit && <Menu.Item onClick={() => setEditing(true)}>{t('common.edit')}</Menu.Item>}
                {(canPromote || canMove) &&
                  targets.map((column) => (
                    <Menu.Item
                      key={column.id}
                      onClick={() =>
                        act(
                          canMove
                            ? boardWrites.move(postIt.id, column.id)
                            : boardWrites.promote(postIt.id, column.id),
                        )
                      }
                    >
                      {t(canMove ? 'sessionZero.postIt.moveTo' : 'sessionZero.postIt.promoteTo', {
                        column: t(`sessionZero.kinds.${column.kind!}`),
                      })}
                    </Menu.Item>
                  ))}
                {canDelete && (
                  <Menu.Item color="red" onClick={() => act(boardWrites.deletePostIt(postIt.id))}>
                    {t('common.delete')}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <Group gap={6} wrap="wrap">
          <Text size="xs" c="dimmed">
            {author}
          </Text>
          {postIt.draft && (
            <Badge size="xs" variant="outline" color="gray">
              {t('sessionZero.postIt.draft')}
            </Badge>
          )}
          {postIt.mine && postIt.anonymous && (
            <Badge size="xs" variant="light" color="gray">
              {t('sessionZero.postIt.anonymous')}
            </Badge>
          )}
          {postIt.fromRetro && (
            <Badge size="xs" variant="light" color="gray">
              {t('sessionZero.postIt.fromRetro')}
            </Badge>
          )}
        </Group>
        {(postIt.reactions.length > 0 || canReact) && (
          <Group gap={4} wrap="wrap">
            <ReactionChips
              reactions={postIt.reactions}
              members={members}
              disabled={!canReact || busy}
              onToggle={(emoji, add) => act(boardWrites.react(postIt.id, emoji, add))}
            />
            {canReact && (
              <AddReaction
                reactions={postIt.reactions}
                disabled={busy}
                onToggle={(emoji, add) => act(boardWrites.react(postIt.id, emoji, add))}
              />
            )}
          </Group>
        )}
      </Stack>
      {publishing && (
        <PublishModal
          busy={busy}
          onClose={() => setPublishing(false)}
          onPublish={(anonymous) => {
            act(boardWrites.publish(postIt.id, anonymous));
            setPublishing(false);
          }}
        />
      )}
    </Paper>
  );
}

interface PublishModalProps {
  busy: boolean;
  onClose: () => void;
  onPublish: (anonymous: boolean) => void;
}

/** Decision 7: publishing shows the post-it to every member, signed or anonymous. It can't be undone. */
function PublishModal({ busy, onClose, onPublish }: PublishModalProps) {
  const { t } = useTranslation();
  const [anonymous, setAnonymous] = useState(false);
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.publish.title')} centered>
      <Stack>
        <Text size="sm">{t('sessionZero.publish.body')}</Text>
        <Switch
          label={t('sessionZero.publish.anonymous')}
          description={t('sessionZero.publish.anonymousHint')}
          checked={anonymous}
          onChange={(event) => setAnonymous(event.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => onPublish(anonymous)}>
            {t('sessionZero.postIt.publish')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
