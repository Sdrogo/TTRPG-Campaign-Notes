import { useState } from 'react';
import { Anchor, Badge, Box, Button, Group, Popover, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router-dom';
import { CheckCircleIcon, PushPinIcon } from '@phosphor-icons/react';
import { UserAvatar } from '../UserAvatar';
import { CharacterAvatar } from '../CharacterAvatar';
import { ImageThumbnailGrid } from '../ImageThumbnailGrid';
import { ImageViewerModal } from '../ImageViewerModal';
import { VisibilityBadge } from '../VisibilityBadge';
import { CommentComposer } from './CommentComposer';
import { AddReaction, ReactionChips } from './CommentReactions';
import { useToggleReaction, type CommentFlag } from '../../hooks/useComments';
import { notifyError } from '../../lib/notify';
import { MentionText } from '../mentions/MentionText';
import { displayNameFor, findMember, memberDisplayName } from '../../lib/members';
import { isEdited } from '../../lib/comments';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import type { Character } from '../../types/character';
import type { Comment, CommentFormValues } from '../../types/comment';
import type { DocumentVisibility } from '../../types/document';
import type { Member } from '../../types/member';
import { useTranslation } from 'react-i18next';

interface CommentItemProps {
  roomId: string;
  comment: Comment;
  members: Member[];
  /** What the viewer may write as, offered when they edit the Comment. */
  characters: Character[];
  currentUserId: string;
  onUpdate: (values: CommentFormValues, onDone: () => void) => void;
  updating: boolean;
  onDelete: () => void;
  deleting: boolean;
  /** Opens a reply under this Comment (spec 19); no Reply action without it. */
  onReply?: () => void;
  /**
   * Who this Comment answers, for a reply drawn at the last indentation level
   * below a deeper parent (spec 19 Decision 1).
   */
  inReplyTo?: string;
  /** Limits on the visibility an edit may pick: a reply's parent's (spec 19). */
  visibilityLevels?: DocumentVisibility[];
  granteeIds?: string[] | null;
  /** Posted since the viewer's previous visit (spec 19b): marked "New". */
  isNew?: boolean;
  /**
   * Pins or unpins it, resolves or reopens its branch (spec 19c). Offered
   * only where the backend's `canPin`/`canResolve` allow it.
   */
  onSetFlag?: (flag: CommentFlag, on: boolean) => void;
  /** A pin or resolve change on this Comment is on its way. */
  settingFlag?: boolean;
}

/**
 * One Comment, social-media style: avatar, a bubble with the author's name and
 * text, then a light meta/action line underneath. Edit and delete appear only
 * when the backend's `canEdit`/`canDelete` allow them; a deleted Comment shows
 * as a placeholder. A Comment written as a Character (D-24) leads with the
 * Character's picture and name, linked to its Document, and names the real
 * author underneath.
 */
export function CommentItem({
  roomId,
  comment,
  members,
  characters,
  currentUserId,
  onUpdate,
  updating,
  onDelete,
  deleting,
  onReply,
  inReplyTo,
  visibilityLevels,
  granteeIds,
  isNew = false,
  onSetFlag,
  settingFlag = false,
}: CommentItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const toggleReaction = useToggleReaction(roomId, comment.documentId);
  const onToggleReaction = (emoji: string, add: boolean) =>
    toggleReaction.mutate({ commentId: comment.id, emoji, add }, { onError: notifyError });
  const author = findMember(members, comment.authorId);
  const authorName = memberDisplayName(author);
  const isMine = comment.authorId === currentUserId;
  const character = comment.asCharacter;
  const shownName = character ? character.name : authorName;

  // The Character it was written as stays pickable while editing, even if
  // the author no longer plays it.
  const initialAsDocumentId = character?.documentId ?? null;
  const editCharacters =
    character && !characters.some((c) => c.documentId === character.documentId)
      ? [character, ...characters]
      : characters;

  const you = isMine && (
    <Text span size="xs" c="dimmed" fw={400}>
      {' '}
      {t('comments.you')}
    </Text>
  );

  return (
    <Group align="flex-start" gap="sm" wrap="nowrap" data-testid="comment-item">
      {character ? (
        <CharacterAvatar character={character} size="md" mt={2} />
      ) : (
        <UserAvatar user={author} size="md" mt={2} />
      )}
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        {inReplyTo && (
          <Text size="xs" c="dimmed" pl="xs">
            {t('comments.inReplyTo', { name: inReplyTo })}
          </Text>
        )}
        {editing ? (
          <CommentComposer
            members={members}
            currentUserId={currentUserId}
            submitLabel={t('common.save')}
            initialValues={{
              body: comment.body,
              visibility: comment.visibility,
              selectiveUserIds: comment.selectiveUserIds,
              newImages: [],
              removedImageIds: [],
              asDocumentId: initialAsDocumentId,
            }}
            existingImages={comment.images}
            characters={editCharacters}
            // The current level and grants stay pickable even when the parent
            // was narrowed since: keeping them is not a change.
            visibilityLevels={
              visibilityLevels && [...new Set([...visibilityLevels, comment.visibility])]
            }
            granteeIds={granteeIds && [...new Set([...granteeIds, ...comment.selectiveUserIds])]}
            onSubmit={(values) =>
              onUpdate(
                // Unchanged, the Character is omitted so the backend keeps
                // it rather than checking again that the author may use it.
                values.asDocumentId === initialAsDocumentId
                  ? { ...values, asDocumentId: undefined }
                  : values,
                () => setEditing(false),
              )
            }
            submitting={updating}
            onCancel={() => setEditing(false)}
            autoFocus
          />
        ) : (
          <Box
            px="sm"
            py={8}
            // Always the full width of the thread, however short the text.
            w="100%"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--mantine-radius-md)',
            }}
          >
            <Group gap="xs" wrap="wrap">
              {character ? (
                <Group gap={6} wrap="wrap">
                  <Anchor
                    component={Link}
                    to={`/rooms/${roomId}/documents/${character.documentId}`}
                    size="sm"
                    fw={600}
                    c="var(--accent-primary)"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {character.name}
                  </Anchor>
                  <Group gap={4} wrap="nowrap">
                    <UserAvatar user={author} size={16} />
                    <Text size="xs" c="dimmed">
                      {t('characters.writtenBy', { name: authorName })}
                      {you}
                    </Text>
                  </Group>
                </Group>
              ) : (
                <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                  {authorName}
                  {you}
                </Text>
              )}
              {comment.visibility !== 'room' && (
                <VisibilityBadge visibility={comment.visibility} size="xs" />
              )}
              {isNew && (
                <Badge size="xs" variant="filled" color="accent">
                  {t('comments.new')}
                </Badge>
              )}
              {comment.pinnedAt && (
                <Badge
                  size="xs"
                  variant="light"
                  color="accent"
                  leftSection={<PushPinIcon size={10} weight="fill" />}
                >
                  {t('comments.pinned')}
                </Badge>
              )}
              {comment.resolvedAt && (
                <Tooltip
                  label={t('comments.resolvedBy', {
                    name: displayNameFor(members, comment.resolvedBy ?? ''),
                    date: formatAbsoluteTime(comment.resolvedAt),
                  })}
                  withArrow
                >
                  <Badge
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={
                      <CheckCircleIcon size={10} weight="fill" color="var(--state-success)" />
                    }
                  >
                    {t('comments.resolved')}
                  </Badge>
                </Tooltip>
              )}
            </Group>
            {comment.deleted ? (
              <Text size="sm" c="dimmed" fs="italic">
                {t('comments.deleted')}
              </Text>
            ) : (
              <Stack gap="xs">
                <MentionText
                  text={comment.body}
                  size="sm"
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                />
                <CommentImages images={comment.images} authorName={shownName} />
              </Stack>
            )}
          </Box>
        )}

        {!editing && !comment.deleted && (
          <ReactionChips
            reactions={comment.reactions}
            members={members}
            onToggle={onToggleReaction}
            disabled={toggleReaction.isPending}
          />
        )}

        {!editing && (
          <Group gap="sm" pl="xs">
            <Tooltip label={formatAbsoluteTime(comment.createdAt)} withArrow>
              <Text size="xs" c="dimmed" component="time" dateTime={comment.createdAt}>
                {formatRelativeTime(comment.createdAt)}
              </Text>
            </Tooltip>
            {isEdited(comment) && (
              <Tooltip label={t('comments.editedAt', { date: formatAbsoluteTime(comment.updatedAt) })} withArrow>
                <Text size="xs" c="dimmed">
                  {t('comments.edited')}
                </Text>
              </Tooltip>
            )}
            {!comment.deleted && (
              <AddReaction
                comment={comment}
                onToggle={onToggleReaction}
                disabled={toggleReaction.isPending}
              />
            )}
            {onReply && !comment.deleted && (
              <CommentAction onClick={onReply}>{t('comments.reply')}</CommentAction>
            )}
            {comment.canEdit && (
              <CommentAction onClick={() => setEditing(true)}>{t('common.edit')}</CommentAction>
            )}
            {onSetFlag && comment.canPin && (
              <CommentAction
                disabled={settingFlag}
                onClick={() => onSetFlag('pin', comment.pinnedAt === null)}
              >
                {comment.pinnedAt === null ? t('comments.pin') : t('comments.unpin')}
              </CommentAction>
            )}
            {onSetFlag && comment.canResolve && (
              <CommentAction
                disabled={settingFlag}
                onClick={() => onSetFlag('resolve', comment.resolvedAt === null)}
              >
                {comment.resolvedAt === null ? t('comments.resolve') : t('comments.reopen')}
              </CommentAction>
            )}
            {comment.canDelete && (
              <DeleteCommentAction
                onConfirm={onDelete}
                loading={deleting}
                imageCount={comment.images.length}
              />
            )}
          </Group>
        )}
      </Stack>
    </Group>
  );
}

interface CommentActionProps {
  children: string;
  onClick: () => void;
  disabled?: boolean;
}

function CommentAction({ children, onClick, disabled = false }: CommentActionProps) {
  return (
    <UnstyledButton onClick={onClick} disabled={disabled}>
      <Text size="xs" fw={600} c="dimmed" className="comment-action">
        {children}
      </Text>
    </UnstyledButton>
  );
}

interface DeleteCommentActionProps {
  onConfirm: () => void;
  loading: boolean;
  imageCount: number;
}

function DeleteCommentAction({ onConfirm, loading, imageCount }: DeleteCommentActionProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <UnstyledButton onClick={() => setOpened((current) => !current)}>
          <Text size="xs" fw={600} c="dimmed" className="comment-action">
            {t('common.delete')}
          </Text>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm">{t('comments.deleteConfirm')}</Text>
          {imageCount > 0 && (
            <Text size="xs" c="dimmed" maw={240}>
              {t('comments.deleteImagesWarning')}
            </Text>
          )}
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="xs"
              color="red"
              loading={loading}
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function CommentImages({ images, authorName }: { images: Comment['images']; authorName: string }) {
  const { t } = useTranslation();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <>
      <ImageThumbnailGrid
        images={images.map((image, index) => ({
          id: image.id,
          url: image.url,
          label: t('comments.imageLabel', { index: index + 1, author: authorName }),
        }))}
        size={120}
        onOpen={setViewerIndex}
      />
      <ImageViewerModal
        images={images}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
        alt={t('comments.imagesAlt', { author: authorName })}
      />
    </>
  );
}
