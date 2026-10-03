import { useMemo } from 'react';
import { Anchor, Text, type TextProps } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import {
  mentionHref,
  resolveContentToken,
  splitMentions,
  type MentionSegment,
} from '../../lib/documentMentions';
import { resolveUserMention, splitMentionTokens, type UserMention } from '../../lib/mentionTokens';
import type { Member } from '../../types/member';

interface MentionTextProps extends TextProps {
  text: string;
  /**
   * False inside something that is already a link (e.g. a `DocumentCard`):
   * mentions are then only colored, since links can't nest.
   */
  linked?: boolean;
  /**
   * The Room's members, where `text` may hold `@[Name](user:<uuid>)` tokens
   * (Comments, spec 19c): each is shown as `@Name`.
   */
  members?: Member[];
}

/**
 * Text with `#` mentions rendered as accent-colored links: a Document
 * mention opens the Document, a Tag mention the Documents with that Tag. A
 * token shows its target's current name; one the viewer can't resolve (a
 * hidden or deleted target) reads as plain text with its stored name.
 * Given `members`, a mention of a member is highlighted under their current
 * name; one of someone who has left reads as plain text with the name written.
 */
export function MentionText({ text, linked = true, members, ...textProps }: MentionTextProps) {
  const mentions = useDocumentMentions();
  const segments = useMemo(() => {
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

  return (
    <Text {...textProps}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return segment.text;
        }
        if (segment.kind === 'user') {
          const resolved = resolveUserMention(segment, members!);
          return resolved.member ? (
            <Text
              key={index}
              span
              inherit
              fw={600}
              c="var(--accent-primary)"
              data-testid="user-mention"
            >
              {resolved.text}
            </Text>
          ) : (
            resolved.text
          );
        }
        const testId = `${segment.kind}-mention`;
        return linked && mentions ? (
          <Anchor
            key={index}
            component={Link}
            to={mentionHref(mentions.roomId, segment)}
            inherit
            c="var(--accent-primary)"
            data-testid={testId}
          >
            {segment.text}
          </Anchor>
        ) : (
          <Text key={index} span inherit c="var(--accent-primary)" data-testid={testId}>
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}
