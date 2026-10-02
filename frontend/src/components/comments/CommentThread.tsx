import type { ReactNode } from 'react';
import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { EyeSlashIcon } from '@phosphor-icons/react';
import { visibleReplies } from '../../lib/comments';
import type { BranchState, Comment, CommentNode } from '../../types/comment';
import { useTranslation } from 'react-i18next';

/** The deepest indentation drawn: a Comment, its replies, their replies (spec 19 Decision 1). */
export const MAX_THREAD_LEVEL = 3;

interface CommentThreadProps {
  node: CommentNode;
  /** 1 for a top-level Comment, never more than `MAX_THREAD_LEVEL`. */
  level?: number;
  /** Who this Comment answers, when it's drawn level with a deeper parent. */
  inReplyTo?: string;
  /** Branches expanded or collapsed by hand, by Comment id. */
  branchStates: Record<string, BranchState>;
  onBranchChange: (commentId: string, state: BranchState) => void;
  /** Draws one Comment (and anything under it, like a reply composer). */
  renderComment: (comment: Comment, inReplyTo: string | undefined) => ReactNode;
  /** The name a Comment is shown by, for "in reply to". */
  nameOf: (comment: Comment) => string;
}

// One indentation step. Small on a phone, so level 3 still reads at 390px.
function Indent({ children }: { children: ReactNode }) {
  return (
    <Box
      ml={{ base: 'xs', sm: 'md' }}
      pl={{ base: 'xs', sm: 'md' }}
      style={{ borderLeft: '2px solid var(--border-default)' }}
    >
      {children}
    </Box>
  );
}

/**
 * A Comment and its replies, drawn as a tree (spec 19): indented up to
 * `MAX_THREAD_LEVEL`, deeper replies drawn at that level with an "in reply to"
 * line. A branch with many replies starts collapsed (Decision 4), and any
 * branch can be collapsed or expanded by hand. A reply whose parent the viewer
 * can't see sits under a placeholder that says nothing about it (Decision 6).
 */
export function CommentThread(props: CommentThreadProps) {
  const { t } = useTranslation();
  const {
    node,
    level = 1,
    inReplyTo,
    branchStates,
    onBranchChange,
    renderComment,
    nameOf,
  } = props;
  const { comment } = node;

  if (level === 1 && comment.parentHidden) {
    return (
      <Stack gap="sm">
        <Group
          gap="xs"
          px="sm"
          py={8}
          wrap="nowrap"
          style={{
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <EyeSlashIcon size={16} color="var(--text-muted)" />
          <Text size="sm" c="dimmed" fs="italic">
            {t('comments.parentHidden')}
          </Text>
        </Group>
        <Indent>
          <CommentThread {...props} level={2} />
        </Indent>
      </Stack>
    );
  }

  const { shown, hiddenCount } = visibleReplies(node, branchStates[comment.id]);
  const childLevel = Math.min(level + 1, MAX_THREAD_LEVEL);
  // Past the last level, a reply is drawn beside its parent, so it says whom
  // it answers.
  const childReplyTo = level === MAX_THREAD_LEVEL ? nameOf(comment) : undefined;

  const replies = node.replies.length > 0 && (
    <Stack gap="sm">
      {shown.map((reply) => (
        <CommentThread
          {...props}
          key={reply.comment.id}
          node={reply}
          level={childLevel}
          inReplyTo={childReplyTo}
        />
      ))}
      <Group gap="xs">
        {hiddenCount > 0 && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => onBranchChange(comment.id, 'open')}
          >
            {shown.length > 0
              ? t('comments.thread.showMore', { count: hiddenCount })
              : t('comments.thread.show', { count: hiddenCount })}
          </Button>
        )}
        {shown.length > 0 && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => onBranchChange(comment.id, 'closed')}
          >
            {t('comments.thread.hide')}
          </Button>
        )}
      </Group>
    </Stack>
  );

  return (
    <Stack gap="sm" data-testid="comment-branch">
      {renderComment(comment, inReplyTo)}
      {replies && (level < MAX_THREAD_LEVEL ? <Indent>{replies}</Indent> : replies)}
    </Stack>
  );
}
