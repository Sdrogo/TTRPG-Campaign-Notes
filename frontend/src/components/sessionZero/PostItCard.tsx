import { useCallback, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Badge, Button, Group, Menu, Modal, Paper, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AddReaction, ReactionChips } from '../comments/CommentReactions';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import { boardWrites, columnColor } from '../../lib/sessionZero';
import { dragKey } from '../../lib/sessionZeroDnd';
import type { PostIt, PostItColumn } from '../../types/sessionZero';
import { useDndState, type DropData } from './boardDrag';
import { PostItEditor } from './PostItEditor';
import { useBoard } from './boardContext';

interface PostItCardProps {
  postIt: PostIt;
  /** Its column: its colour, and the post-its it can be grouped with. */
  column: PostItColumn;
  /** On the Lines & Veils board: the Master moves it, a Retro one is promoted. */
  onLinesVeils: boolean;
}

/**
 * One post-it (spec 46 Design 46_3, restyled by spec 46c Decision 7): a
 * sticky note tinted with its column's colour, its text, who wrote it
 * ("Anonymous" for someone else's anonymous one), a "Draft" or "from the
 * Retro" badge, the reactions, a visible "Publish" on the viewer's draft
 * (Decision 8), and a "⋮" with what the backend allows the viewer: publish,
 * edit, promote to or move between Must / Veils / Lines, group, delete.
 * Dragged into place by whoever may move it (spec 46d Decision 7: the
 * Master any, a Player their own), onto a Lines & Veils row to promote it,
 * or onto another post-it to group them: that one then shows a ring and
 * "Group". Dragged, it stays in place faded.
 */
export function PostItCard({ postIt, column, onLinesVeils }: PostItCardProps) {
  const { t } = useTranslation();
  const { board, members, act, busy, writable, glowing } = useBoard();
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [groupingWith, setGroupingWith] = useState(false);
  const { intent } = useDndState();
  const canEdit = writable && postIt.canEdit;
  const canDelete = writable && postIt.canDelete;
  const canPublish = writable && postIt.canPublish;
  const canPromote = writable && postIt.canPromote;
  const canMove = writable && postIt.canMove;
  const canReact = writable && postIt.canReact;
  const canGroup = writable && postIt.canGroup;
  const canDrag = writable && (postIt.canPlace || postIt.canPromote);
  const partners = canGroup ? groupPartners(postIt, column, board.canManage) : [];
  const targets = board.linesVeils.filter((other) => !(canMove && other.id === postIt.columnId));
  const hasMenu = canEdit || canDelete || canPublish || canPromote || canMove || canGroup;
  const tint = { '--sz-color': columnColor(column) } as CSSProperties;

  const author =
    postIt.authorId === null
      ? t('sessionZero.postIt.anonymous')
      : postIt.mine
        ? t('common.you')
        : displayNameFor(members, postIt.authorId);

  const key = dragKey({ kind: 'card', id: postIt.id });
  const draggable = useDraggable({ id: key, disabled: !canDrag });
  const data: DropData = { ref: { kind: 'card', id: postIt.id }, axis: onLinesVeils ? 'x' : 'y' };
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
  const groupTarget = intent?.kind === 'group' && intent.withId === postIt.id;
  // Space or Enter on the post-it itself picks it up; on its buttons they press them.
  const { onKeyDown, ...pointerListeners } = draggable.listeners ?? {};
  const dragProps = canDrag
    ? {
        ...pointerListeners,
        tabIndex: 0,
        'aria-describedby': draggable.attributes['aria-describedby'],
        onKeyDown: (event: KeyboardEvent) => {
          if (event.target === event.currentTarget) onKeyDown?.(event);
        },
      }
    : {};

  if (editing) {
    return (
      <Paper withBorder radius="sm" p="xs" className="sz-post-it" style={tint}>
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
      p="xs"
      className="sz-post-it"
      data-draft={postIt.draft || undefined}
      data-glow={glowing.has(postIt.id) || undefined}
      data-group-target={groupTarget || undefined}
      data-dragging={draggable.isDragging || undefined}
      ref={nodeRef}
      {...dragProps}
      aria-label={t('sessionZero.postIt.label', { author })}
      role="article"
      style={{ ...tint, cursor: canDrag ? 'grab' : undefined, userSelect: canDrag ? 'none' : undefined }}
    >
      {groupTarget && (
        <Badge size="sm" className="sz-group-here">
          {t('sessionZero.dnd.groupHere')}
        </Badge>
      )}
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {postIt.body}
          </Text>
          {hasMenu && (
            <Menu position="bottom-end" shadow="md">
              <Menu.Target>
                <LabeledActionIcon variant="subtle" color="gray" size="sm" aria-label={t('sessionZero.postIt.actions')}>
                  <DotsThreeVerticalIcon size={18} />
                </LabeledActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canPublish && (
                  <Menu.Item onClick={() => setPublishing(true)}>{t('sessionZero.postIt.publish')}</Menu.Item>
                )}
                {canEdit && <Menu.Item onClick={() => setEditing(true)}>{t('common.edit')}</Menu.Item>}
                {(canPromote || canMove) &&
                  targets.map((target) => (
                    <Menu.Item
                      key={target.id}
                      onClick={() =>
                        act(
                          canMove
                            ? boardWrites.move(postIt.id, target.id)
                            : boardWrites.promote(postIt.id, target.id),
                        )
                      }
                    >
                      {t(canMove ? 'sessionZero.postIt.moveTo' : 'sessionZero.postIt.promoteTo', {
                        column: t(`sessionZero.kinds.${target.kind!}`),
                      })}
                    </Menu.Item>
                  ))}
                {partners.length > 0 && (
                  <Menu.Item onClick={() => setGroupingWith(true)}>{t('sessionZero.groups.groupWith')}</Menu.Item>
                )}
                {canGroup && board.canManage && postIt.groupId && (
                  <Menu.Item onClick={() => act(boardWrites.ungroup(postIt.id))}>
                    {t('sessionZero.groups.takeOut')}
                  </Menu.Item>
                )}
                {canDelete && (
                  <Menu.Item color="red" onClick={() => act(boardWrites.deletePostIt(postIt.id))}>
                    {t('common.delete')}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <Group gap={6} wrap="wrap" justify="space-between">
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
          {canPublish && (
            <Button size="compact-xs" disabled={busy} onClick={() => setPublishing(true)}>
              {t('sessionZero.postIt.publish')}
            </Button>
          )}
        </Group>
        {(postIt.reactions.length > 0 || canReact) && (
          <Group gap={4} wrap="wrap">
            <ReactionChips
              size="lg"
              reactions={postIt.reactions}
              members={members}
              disabled={!canReact || busy}
              onToggle={(emoji, add) => act(boardWrites.react(postIt.id, emoji, add))}
            />
            {canReact && (
              <AddReaction
                size="lg"
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
          title={t('sessionZero.publish.title')}
          body={t('sessionZero.publish.body')}
          busy={busy}
          onClose={() => setPublishing(false)}
          onPublish={(anonymous) => act(boardWrites.publish(postIt.id, anonymous), () => setPublishing(false))}
        />
      )}
      {groupingWith && (
        <GroupWithModal
          partners={partners}
          onClose={() => setGroupingWith(false)}
          onPick={(partnerId) => act(boardWrites.group([partnerId, postIt.id]), () => setGroupingWith(false))}
        />
      )}
    </Paper>
  );
}

/** One choice of "Group with…": a group of the column, or a post-it in none. */
interface GroupPartner {
  /** The post-it to group with (a group's first one). */
  cardId: string;
  label: string;
  /** Set on a group: its title and how many post-its it holds. */
  group?: { title: string | null; count: number };
}

/**
 * What `postIt` can be grouped with: the other groups and lone post-its of
 * its column; for a Player, only theirs and groups holding only theirs
 * (spec 46d Q2).
 */
function groupPartners(postIt: PostIt, column: PostItColumn, manage: boolean): GroupPartner[] {
  const partners: GroupPartner[] = [];
  const seen = new Set<string>();
  for (const card of column.cards) {
    if (card.id === postIt.id || !card.canGroup) continue;
    if (card.groupId === null) {
      partners.push({ cardId: card.id, label: card.body });
    } else if (card.groupId !== postIt.groupId && !seen.has(card.groupId)) {
      seen.add(card.groupId);
      const mates = column.cards.filter((c) => c.groupId === card.groupId);
      if (!manage && !mates.every((mate) => mate.mine)) continue;
      const group = column.groups.find((g) => g.id === card.groupId);
      partners.push({
        cardId: card.id,
        label: card.body,
        group: { title: group?.title ?? null, count: mates.length },
      });
    }
  }
  return partners;
}

interface GroupWithModalProps {
  partners: GroupPartner[];
  onClose: () => void;
  onPick: (cardId: string) => void;
}

/** "Group with…" (Decision 9), the drag's alternative on a phone. */
function GroupWithModal({ partners, onClose, onPick }: GroupWithModalProps) {
  const { t } = useTranslation();
  const { busy } = useBoard();
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.groups.groupWith')} centered>
      <Stack gap="xs">
        <Text size="sm">{t('sessionZero.groups.groupWithBody')}</Text>
        {partners.map((partner) => (
          <UnstyledButton
            key={partner.cardId}
            disabled={busy}
            onClick={() => onPick(partner.cardId)}
            p="xs"
            style={{ border: '1px solid var(--border-default)', borderRadius: 8 }}
          >
            {partner.group ? (
              <PartnerLine
                head={partner.group.title ?? t('sessionZero.groups.untitled')}
                tail={t('sessionZero.groups.count', { count: partner.group.count })}
              />
            ) : (
              <PartnerLine head={partner.label} />
            )}
          </UnstyledButton>
        ))}
      </Stack>
    </Modal>
  );
}

function PartnerLine({ head, tail }: { head: string; tail?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
        {head}
      </Text>
      {tail && (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {tail}
        </Text>
      )}
    </Group>
  );
}

interface PublishModalProps {
  title: string;
  body: ReactNode;
  busy: boolean;
  onClose: () => void;
  onPublish: (anonymous: boolean) => void;
}

/**
 * Decision 7: publishing shows the post-it to every member, signed or
 * anonymous. It can't be undone. "Publish all drafts" asks the same, once
 * for all of them (spec 46c Decision 8). Closes once the write succeeds.
 */
export function PublishModal({ title, body, busy, onClose, onPublish }: PublishModalProps) {
  const { t } = useTranslation();
  const [anonymous, setAnonymous] = useState(false);
  return (
    <Modal opened onClose={onClose} title={title} centered>
      <Stack>
        <Text size="sm">{body}</Text>
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
