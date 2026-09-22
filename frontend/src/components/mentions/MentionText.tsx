import { useMemo } from 'react';
import { Anchor, Text, type TextProps } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { splitMentions } from '../../lib/documentMentions';

interface MentionTextProps extends TextProps {
  text: string;
  // False inside something that is already a link (e.g. a `DocumentCard`):
  // mentions are then only colored, since links can't nest.
  linked?: boolean;
}

// Text with `#Document name` mentions rendered as accent-colored links to
// the Document.
export function MentionText({ text, linked = true, ...textProps }: MentionTextProps) {
  const mentions = useDocumentMentions();
  const segments = useMemo(
    () => splitMentions(text, mentions?.documents ?? []),
    [text, mentions?.documents],
  );

  return (
    <Text {...textProps}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return segment.text;
        }
        return linked && mentions ? (
          <Anchor
            key={index}
            component={Link}
            to={`/rooms/${mentions.roomId}/documents/${segment.document.id}`}
            inherit
            c="var(--accent-primary)"
            data-testid="document-mention"
          >
            {segment.text}
          </Anchor>
        ) : (
          <Text key={index} span inherit c="var(--accent-primary)" data-testid="document-mention">
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}
