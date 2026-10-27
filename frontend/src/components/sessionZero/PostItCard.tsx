import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { Badge, Button, Group, Menu, Modal, Paper, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AddReaction, ReactionChips } from '../comments/CommentReactions';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import { POST_IT_DRAG_TYPE, boardWrites, columnColor, type DraggedPostIt } from '../../lib/sessionZero';
import type { PostIt, PostItColumn } from '../../types/sessionZero';
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
 * edit, promote to or move between Must / Veils / Lines, group, delete. The
 * Master drags it onto a Lines & Veils column, or onto another post-it of
 * its Retro column to group them (Decision 9).
 */
export function PostItCard({ postIt, column, onLinesVeils }: PostItCardProps) {
  const { t } = useTranslation();
  const { board, members, act, busy, writable } = useBoard();
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [groupingWith, setGroupingWith] = useState(false);
  const [over, setOver] = useState(false);
  const canEdit = writable && postIt.canEdit;
  const canDelete = writable && postIt.canDelete;
  const canPublish = writable && postIt.canPublish;
  const canPromote = writable && postIt.canPromote;
  const canMove = writable && postIt.canMove;
  const canReact = writable && postIt.canReact;
  const canGroup = writable && postIt.canGroup;
  const partners = canGroup ? groupPartners(postIt, column) : [];
  const targets = board.linesVeils.filter((other) => !(canMove && other.id === postIt.columnId));
  const hasMenu = canEdit || canDelete || canPublish || canPromote || canMove || canGroup;
  const tint = { '--sz-color': columnColor(column) } as CSSProperties;

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
    event.dataTransfer.effectAllowed = onLinesVeils ? 'move' : 'copyMove';
  };
  // Another published post-it of this column, dropped here, joins it (Decision 9).
  const accepts = (event: DragEvent) => canGroup && event.dataTransfer.types.includes(POST_IT_DRAG_TYPE);
  const onDrop = (event: DragEvent) => {
    setOver(false);
    if (!accepts(event)) return;
    event.preventDefault();
    const dragged = JSON.parse(event.dataTransfer.getData(POST_IT_DRAG_TYPE)) as DraggedPostIt;
    if (dragged.action === 'promote' && dragged.columnId === postIt.columnId && dragged.id !== postIt.id) {
      act(boardWrites.group([postIt.id, dragged.id]));
    }
  };

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
      data-drop-over={over || undefined}
      draggable={canPromote || canMove}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      aria-label={t('sessionZero.postIt.label', { author })}
      role="article"
      style={{ ...tint, cursor: canPromote || canMove ? 'grab' : undefined }}
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
                {canGroup && postIt.groupId && (
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

/** What `postIt` can be grouped with: the other groups and lone post-its of its column. */
function groupPartners(postIt: PostIt, column: PostItColumn): GroupPartner[] {
  const partners: GroupPartner[] = [];
  const seen = new Set<string>();
  for (const card of column.cards) {
    if (card.id === postIt.id || !card.canGroup) continue;
    if (card.groupId === null) {
      partners.push({ cardId: card.id, label: card.body });
    } else if (card.groupId !== postIt.groupId && !seen.has(card.groupId)) {
      seen.add(card.groupId);
      const group = column.groups.find((g) => g.id === card.groupId);
      partners.push({
        cardId: card.id,
        label: card.body,
        group: {
          title: group?.title ?? null,
          count: column.cards.filter((c) => c.groupId === card.groupId).length,
        },
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
