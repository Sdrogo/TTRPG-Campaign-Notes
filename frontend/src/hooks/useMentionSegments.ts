import { useMemo } from 'react';
import { useDocumentMentions } from './useDocumentMentions';
import { resolveContentToken, splitMentions, type MentionSegment } from '../lib/documentMentions';
import { splitGlossaryTerms } from '../lib/glossary';
import { splitMentionTokens, type UserMention } from '../lib/mentionTokens';
import type { GlossaryEntry } from '../types/glossary';
import type { Member } from '../types/member';

/** A Glossary term found in plain text (spec 79 Decision 10). */
export interface GlossarySegment {
  kind: 'glossary';
  text: string;
  entry: GlossaryEntry;
}

/**
 * `text` split into plain runs and mentions, as `MentionText` shows them: a
 * token resolved against the Room's Documents and Tags the viewer sees, a
 * plain `#Name` from before mentions had ids (spec 20) matched by name, and
 * given `members`, member tokens.
 */
export function useMentionSegments(
  text: string,
  members?: Member[],
): (MentionSegment | UserMention | GlossarySegment)[] {
  const mentions = useDocumentMentions();
  return useMemo(() => {
    const documents = mentions?.documents ?? [];
    const tags = mentions?.tags ?? [];
    const glossary = mentions?.glossary ?? [];
    // One set for the whole text: a term is highlighted once, wherever it first appears.
    const used = new Set<string>();
    const withTerms = (segment: MentionSegment): (MentionSegment | GlossarySegment)[] =>
      segment.kind === 'text' && glossary.length > 0
        ? splitGlossaryTerms(segment.text, glossary, true, used)
        : [segment];
    return splitMentionTokens(text, { users: members !== undefined }).flatMap(
      (run): (MentionSegment | UserMention | GlossarySegment)[] => {
        if (run.kind === 'text') {
          // Plain `#Name` from before mentions had ids (spec 20).
          return splitMentions(run.stored, documents, tags).flatMap(withTerms);
        }
        return run.kind === 'user' ? [run as UserMention] : [resolveContentToken(run, documents, tags)];
      },
    );
  }, [text, members, mentions?.documents, mentions?.tags, mentions?.glossary]);
}
