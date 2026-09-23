import { useMemo } from 'react';
import { Anchor, Text, type TextProps } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { mentionHref, splitMentions } from '../../lib/documentMentions';

interface MentionTextProps extends TextProps {
  text: string;
  /**
   * False inside something that is already a link (e.g. a `DocumentCard`):
   * mentions are then only colored, since links can't nest.
   */
  linked?: boolean;
}

/**
 * Text with `#Name` mentions rendered as accent-colored links: a Document
 * mention opens the Document, a Tag mention the Documents with that Tag.
 */
export function MentionText({ text, linked = true, ...textProps }: MentionTextProps) {
  const mentions = useDocumentMentions();
  const segments = useMemo(
    () => splitMentions(text, mentions?.documents ?? [], mentions?.tags ?? []),
    [text, mentions?.documents, mentions?.tags],
  );

  return (
    <Text {...textProps}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return segment.text;
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
