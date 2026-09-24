import { useState } from 'react';
import { Box, Button, Group, Popover, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { UserAvatar } from '../UserAvatar';
import { ImageThumbnailGrid } from '../ImageThumbnailGrid';
import { ImageViewerModal } from '../ImageViewerModal';
import { VisibilityBadge } from '../VisibilityBadge';
import { CommentComposer } from './CommentComposer';
import { MentionText } from '../mentions/MentionText';
import { findMember, memberDisplayName } from '../../lib/members';
import { isEdited } from '../../lib/comments';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import type { Comment, CommentFormValues } from '../../types/comment';
import type { Member } from '../../types/member';
import { useTranslation } from 'react-i18next';

interface CommentItemProps {
  comment: Comment;
  members: Member[];
  currentUserId: string;
  onUpdate: (values: CommentFormValues, onDone: () => void) => void;
  updating: boolean;
  onDelete: () => void;
  deleting: boolean;
}

/**
 * One Comment, social-media style: avatar, a bubble with the author's name and
 * text, then a light meta/action line underneath. Edit and delete appear only
 * when the backend's `canEdit`/`canDelete` allow them; a deleted Comment shows
 * as a placeholder.
 */
export function CommentItem({
  comment,
  members,
  currentUserId,
  onUpdate,
  updating,
  onDelete,
  deleting,
}: CommentItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const author = findMember(members, comment.authorId);
  const authorName = memberDisplayName(author);
  const isMine = comment.authorId === currentUserId;

  return (
    <Group align="flex-start" gap="sm" wrap="nowrap" data-testid="comment-item">
      <UserAvatar user={author} size="md" mt={2} />
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
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
            }}
            existingImages={comment.images}
            onSubmit={(values) => onUpdate(values, () => setEditing(false))}
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
              <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                {authorName}
                {isMine && (
                  <Text span size="xs" c="dimmed" fw={400}>
                    {' '}
                    {t('comments.you')}
                  </Text>
                )}
              </Text>
              {comment.visibility !== 'room' && (
                <VisibilityBadge visibility={comment.visibility} size="xs" />
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
                <CommentImages images={comment.images} authorName={authorName} />
              </Stack>
            )}
          </Box>
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
            {comment.canEdit && (
              <CommentAction onClick={() => setEditing(true)}>{t('common.edit')}</CommentAction>
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

function CommentAction({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick}>
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
