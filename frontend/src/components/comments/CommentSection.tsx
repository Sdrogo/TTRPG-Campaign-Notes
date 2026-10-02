import { useMemo, useState } from 'react';
import { Badge, Box, Button, Divider, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { ChatCircleDotsIcon, PushPinIcon } from '@phosphor-icons/react';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';
import { CommentThread } from './CommentThread';
import { CommentToolbar } from './CommentToolbar';
import { UserAvatar } from '../UserAvatar';
import { PageCard } from '../PageCard';
import {
  useComments,
  useDeleteComment,
  useSaveComment,
  useSetCommentFlag,
  type CommentFlag,
} from '../../hooks/useComments';
import { useDocumentVisit } from '../../hooks/useDocuments';
import { useMyCharacters } from '../../hooks/useCharacters';
import { readLastPostAs, saveLastPostAs } from '../../lib/characters';
import type { SaveCommentResult } from '../../hooks/useComments';
import {
  DEFAULT_COMMENT_FILTERS,
  EMPTY_COMMENT_VALUES,
  buildCommentTree,
  commentAuthors,
  commentShownName,
  isNewComment,
  replyGranteeIds,
  replyLevels,
  replyStartVisibility,
  splitPinned,
  topLevelComments,
} from '../../lib/comments';
import { findMember } from '../../lib/members';
import { notifyError } from '../../lib/notify';
import type { BranchState, Comment, CommentFilters, CommentNode } from '../../types/comment';
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
 * A Document's Comments (its main Thread, D-20): sort/filter toolbar, the
 * Comments with their replies as a tree (spec 19), and the composer at the
 * bottom. The toolbar picks and orders the top-level Comments; each brings its
 * whole branch. Pinned Comments come first in a section of their own, ahead
 * of the sort, and a resolved branch starts collapsed (spec 19c). The backend
 * only returns Comments the viewer may see. Once the Thread loads, the visit
 * is recorded and what was posted since the previous one is marked "New"
 * (spec 19b).
 */
export function CommentSection({ roomId, documentId, members, currentUserId }: CommentSectionProps) {
  const { t, i18n } = useTranslation();
  const comments = useComments(roomId, documentId, true);
  const saveComment = useSaveComment(roomId, documentId);
  const deleteComment = useDeleteComment(roomId, documentId);
  const setFlag = useSetCommentFlag(roomId, documentId);
  const myCharacters = useMyCharacters(roomId, true);
  const newSince = useDocumentVisit(roomId, documentId, comments.isSuccess);
  const isNew = (comment: Comment) => isNewComment(comment, newSince, currentUserId);
  const [filters, setFilters] = useState<CommentFilters>(DEFAULT_COMMENT_FILTERS);
  // Branches expanded or collapsed by hand; not remembered across visits.
  const [branchStates, setBranchStates] = useState<Record<string, BranchState>>({});
  // The Comment whose reply composer is open, at most one at a time.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const all = useMemo(() => comments.data ?? [], [comments.data]);
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  const topLevelCount = useMemo(() => topLevelComments(all).length, [all]);
  const shown = useMemo(() => buildCommentTree(all, filters, members), [all, filters, members]);
  const { pinned, others } = useMemo(() => splitPinned(shown), [shown]);
  // commentAuthors reaches the active global translator for unknown-user labels.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const authorOptions = useMemo(() => commentAuthors(all, members), [all, members, i18n.language]);
  const savingId = saveComment.isPending ? saveComment.variables?.commentId : undefined;
  // Which new Comment is being posted: null for a top-level one, else the
  // id of the Comment it answers. Undefined while nothing new is posting.
  const postingParent =
    saveComment.isPending && savingId === undefined
      ? (saveComment.variables?.values.parentId ?? null)
      : undefined;
  const setBranch = (commentId: string, state: BranchState) =>
    setBranchStates((current) => ({ ...current, [commentId]: state }));
  // Back to the branch's default: collapsed once resolved, as usual once
  // reopened (spec 19c Decision 4), whatever was chosen by hand before.
  const resetBranch = (commentId: string) =>
    setBranchStates(({ [commentId]: _dropped, ...rest }) => rest);
  // Pin or resolve changes on their way, by Comment id. Each change follows
  // its own promise: `mutate`'s per-call callbacks would only run for the
  // latest of two overlapping changes on different Comments.
  const [flagging, setFlagging] = useState<string[]>([]);
  const onSetFlag = (commentId: string, flag: CommentFlag, on: boolean) => {
    setFlagging((current) => [...current, commentId]);
    setFlag
      .mutateAsync({ commentId, flag, on })
      .then(() => {
        if (flag === 'resolve') resetBranch(commentId);
      }, notifyError)
      .finally(() => setFlagging((current) => current.filter((id) => id !== commentId)));
  };
  const characters = myCharacters.data ?? [];
  // The last "Post as" choice in this Room, if the viewer may still use it.
  const lastPostAs = readLastPostAs(roomId);
  const initialPostAs = characters.some((c) => c.documentId === lastPostAs) ? lastPostAs : null;

  // One Comment of the tree, with its reply composer when it's open. A
  // reply's edit is offered only the visibility its parent allows (VR-04).
  const renderComment = (comment: Comment, inReplyTo: string | undefined, parent?: Comment) => (
    <>
      <CommentItem
        roomId={roomId}
        comment={comment}
        members={members}
        characters={characters}
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
        onReply={() => setReplyingTo(comment.id)}
        inReplyTo={inReplyTo}
        visibilityLevels={parent && replyLevels(parent, currentUserId)}
        granteeIds={parent && replyGranteeIds(parent)}
        isNew={isNew(comment)}
        onSetFlag={(flag, on) => onSetFlag(comment.id, flag, on)}
        settingFlag={flagging.includes(comment.id)}
      />
      {replyingTo === comment.id && (
        <Box pl={{ base: 'md', sm: 'xl' }}>
          <CommentComposer
            members={members}
            currentUserId={currentUserId}
            submitLabel={t('comments.reply')}
            bodyLabel={t('comments.replyLabel', { name: commentShownName(comment, members) })}
            submitting={postingParent === comment.id}
            initialValues={{
              ...EMPTY_COMMENT_VALUES,
              ...replyStartVisibility(comment, currentUserId),
              parentId: comment.id,
              asDocumentId: initialPostAs,
            }}
            visibilityLevels={replyLevels(comment, currentUserId)}
            granteeIds={replyGranteeIds(comment)}
            characters={characters}
            onCancel={() => setReplyingTo(null)}
            autoFocus
            onSubmit={(values) =>
              saveComment.mutate(
                { values },
                {
                  onSuccess: (result) => {
                    reportImageErrors(result);
                    saveLastPostAs(roomId, values.asDocumentId ?? null);
                    setReplyingTo(null);
                    // The new reply must show, even in a collapsed branch.
                    setBranch(comment.id, 'open');
                  },
                  onError: notifyError,
                },
              )
            }
          />
        </Box>
      )}
    </>
  );

  const renderBranch = (node: CommentNode) => (
    <CommentThread
      key={node.comment.id}
      node={node}
      branchStates={branchStates}
      onBranchChange={setBranch}
      nameOf={(comment) => commentShownName(comment, members)}
      isNew={isNew}
      renderComment={(comment, inReplyTo) =>
        renderComment(comment, inReplyTo, byId.get(comment.parentId ?? ''))
      }
    />
  );

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
            {shown.length < topLevelCount && (
              <Text size="xs" c="dimmed">
                {t('comments.filteredCount', { shown: shown.length, count: topLevelCount })}
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
              <>
                {pinned.length > 0 && (
                  <Stack
                    gap="md"
                    component="section"
                    aria-label={t('comments.pinnedSection')}
                    data-testid="pinned-comments"
                  >
                    <Group gap={6}>
                      <PushPinIcon size={14} weight="fill" color="var(--accent-primary)" />
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                        {t('comments.pinnedSection')}
                      </Text>
                    </Group>
                    {pinned.map(renderBranch)}
                    {others.length > 0 && <Divider />}
                  </Stack>
                )}
                <Stack gap="md" data-testid="comment-list">
                  {others.map(renderBranch)}
                </Stack>
              </>
            )}
          </Stack>
        )}

        <Divider />

        <Group align="flex-start" gap="sm" wrap="nowrap" data-testid="new-comment">
          <UserAvatar user={findMember(members, currentUserId)} size="md" mt={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Mounted once the Characters are known, so the composer starts
                on the remembered "Post as" choice. */}
            {myCharacters.isLoading ? (
              <Loader color="accent" size="sm" />
            ) : (
              <CommentComposer
                members={members}
                currentUserId={currentUserId}
                submitLabel={t('comments.publish')}
                submitting={postingParent === null}
                initialValues={{ ...EMPTY_COMMENT_VALUES, asDocumentId: initialPostAs }}
                characters={characters}
                onSubmit={(values, reset) =>
                  saveComment.mutate(
                    { values },
                    {
                      onSuccess: (result) => {
                        reportImageErrors(result);
                        saveLastPostAs(roomId, values.asDocumentId ?? null);
                        reset();
                      },
                      onError: notifyError,
                    },
                  )
                }
              />
            )}
          </div>
        </Group>
      </Stack>
    </PageCard>
  );
}
