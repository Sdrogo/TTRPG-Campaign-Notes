import { useMemo, useState } from 'react';
import { Badge, Button, Divider, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';
import { CommentToolbar } from './CommentToolbar';
import { UserAvatar } from '../UserAvatar';
import { PageCard } from '../PageCard';
import { useComments, useDeleteComment, useSaveComment } from '../../hooks/useComments';
import type { SaveCommentResult } from '../../hooks/useComments';
import {
  DEFAULT_COMMENT_FILTERS,
  applyCommentFilters,
  commentAuthors,
} from '../../lib/comments';
import { findMember } from '../../lib/members';
import { notifyError } from '../../lib/notify';
import type { CommentFilters } from '../../types/comment';
import type { Member } from '../../types/member';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface CommentSectionProps {
  roomId: string;
  documentId: string;
  members: Member[];
  currentUserId: string;
}

// The Comment was saved, but some image changes failed: say which.
function reportImageErrors({ imageErrors }: SaveCommentResult) {
  if (imageErrors.length > 0) {
    notifyError(new Error(i18n.t('comments.savedWithImageErrors', { errors: imageErrors.join('; ') })));
  }
}

/**
 * A Document's Comments (its main Thread, D-20): sort/filter toolbar, the list,
 * and the composer at the bottom. The backend only returns Comments the viewer
 * may see.
 */
export function CommentSection({ roomId, documentId, members, currentUserId }: CommentSectionProps) {
  const { t } = useTranslation();
  const comments = useComments(roomId, documentId, true);
  const saveComment = useSaveComment(roomId, documentId);
  const deleteComment = useDeleteComment(roomId, documentId);
  const [filters, setFilters] = useState<CommentFilters>(DEFAULT_COMMENT_FILTERS);

  const all = useMemo(() => comments.data ?? [], [comments.data]);
  const shown = useMemo(() => applyCommentFilters(all, filters, members), [all, filters, members]);
  const authorOptions = useMemo(() => commentAuthors(all, members), [all, members]);
  const savingId = saveComment.isPending ? saveComment.variables?.commentId : undefined;

  return (
    <PageCard>
      <Stack gap="md">
        <Group gap="xs">
          <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
            {t('comments.title')}
          </Title>
          {all.length > 0 && (
            <Badge variant="light" color="gray">
              {all.length}
            </Badge>
          )}
        </Group>

        {comments.isLoading ? (
          <Group justify="center" py="md">
            <Loader color="accent" size="sm" />
          </Group>
        ) : comments.isError ? (
          <Text c="red" size="sm">
            {t('comments.loadError')}
          </Text>
        ) : all.length === 0 ? (
          <Stack align="center" gap="xs" py="lg">
            <ChatCircleDotsIcon size={40} weight="duotone" color="var(--text-muted)" />
            <Text c="dimmed" size="sm">
              {t('comments.empty')}
            </Text>
          </Stack>
        ) : (
          <Stack gap="md">
            <CommentToolbar filters={filters} onChange={setFilters} authorOptions={authorOptions} />
            {shown.length < all.length && (
              <Text size="xs" c="dimmed">
                {t('comments.filteredCount', { shown: shown.length, count: all.length })}
              </Text>
            )}
            {shown.length === 0 ? (
              <Stack align="center" gap="xs" py="md">
                <Text c="dimmed" size="sm">
                  {t('comments.noMatch')}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => setFilters({ ...DEFAULT_COMMENT_FILTERS, sort: filters.sort })}
                >
                  {t('common.resetFilters')}
                </Button>
              </Stack>
            ) : (
              <Stack gap="md" data-testid="comment-list">
                {shown.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    members={members}
                    currentUserId={currentUserId}
                    updating={savingId === comment.id}
                    onUpdate={(values, onDone) =>
                      saveComment.mutate(
                        { commentId: comment.id, values },
                        {
                          onSuccess: (result) => {
                            reportImageErrors(result);
                            onDone();
                          },
                          onError: notifyError,
                        },
                      )
                    }
                    deleting={deleteComment.isPending && deleteComment.variables === comment.id}
                    onDelete={() => deleteComment.mutate(comment.id, { onError: notifyError })}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        )}

        <Divider />

        <Group align="flex-start" gap="sm" wrap="nowrap" data-testid="new-comment">
          <UserAvatar user={findMember(members, currentUserId)} size="md" mt={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <CommentComposer
              members={members}
              currentUserId={currentUserId}
              submitLabel={t('comments.publish')}
              submitting={saveComment.isPending && savingId === undefined}
              onSubmit={(values, reset) =>
                saveComment.mutate(
                  { values },
                  {
                    onSuccess: (result) => {
                      reportImageErrors(result);
                      reset();
                    },
                    onError: notifyError,
                  },
                )
              }
            />
          </div>
        </Group>
      </Stack>
    </PageCard>
  );
}
