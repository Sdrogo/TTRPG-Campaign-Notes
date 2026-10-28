import { useMemo } from 'react';
import { useDocumentMentions } from './useDocumentMentions';
import { resolveContentToken, splitMentions, type MentionSegment } from '../lib/documentMentions';
import { splitMentionTokens, type UserMention } from '../lib/mentionTokens';
import type { Member } from '../types/member';

/**
 * `text` split into plain runs and mentions, as `MentionText` shows them: a
 * token resolved against the Room's Documents and Tags the viewer sees, a
 * plain `#Name` from before mentions had ids (spec 20) matched by name, and
 * given `members`, member tokens.
 */
export function useMentionSegments(text: string, members?: Member[]): (MentionSegment | UserMention)[] {
  const mentions = useDocumentMentions();
  return useMemo(() => {
    const documents = mentions?.documents ?? [];
    const tags = mentions?.tags ?? [];
    return splitMentionTokens(text, { users: members !== undefined }).flatMap(
      (run): (MentionSegment | UserMention)[] => {
        if (run.kind === 'text') {
          // Plain `#Name` from before mentions had ids (spec 20).
          return splitMentions(run.stored, documents, tags);
        }
        return run.kind === 'user' ? [run as UserMention] : [resolveContentToken(run, documents, tags)];
      },
    );
  }, [text, members, mentions?.documents, mentions?.tags]);
}
