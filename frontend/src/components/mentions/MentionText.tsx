import { Anchor, Text, type TextProps } from '@mantine/core';
import { Link } from 'react-router-dom';
import { DocumentMentionPreview } from './DocumentMentionPreview';
import { DocumentOpenMenu } from '../documents/DocumentOpenMenu';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { useMentionSegments } from '../../hooks/useMentionSegments';
import { mentionHref, type MentionSegment } from '../../lib/documentMentions';
import { resolveUserMention, type UserMention } from '../../lib/mentionTokens';
import type { Member } from '../../types/member';

interface MentionTextProps extends TextProps {
  text: string;
  /**
   * False inside something that is already a link (e.g. a `DocumentCard` in a
   * preview): mentions are then only colored, since links can't nest.
   * `'documents'` on a card that lays its own link over itself (the Documents
   * page, spec 37 Decision 2): only Document mentions are links, raised above
   * the card's link; Tag mentions stay colored text.
   */
  linked?: boolean | 'documents';
  /**
   * The Room's members, where `text` may hold `@[Name](user:<uuid>)` tokens
   * (Comments, spec 19c): each is shown as `@Name`.
   */
  members?: Member[];
}

interface MentionSegmentViewProps {
  segment: Exclude<MentionSegment, { kind: 'text' }> | UserMention;
  linked?: MentionTextProps['linked'];
  members?: Member[];
}

/** One mention of `MentionText` (or of `MarkdownText`, spec 48). */
export function MentionSegmentView({ segment, linked = true, members }: MentionSegmentViewProps) {
  const mentions = useDocumentMentions();
  if (segment.kind === 'user') {
    const resolved = resolveUserMention(segment, members!);
    return resolved.member ? (
      <Text span inherit fw={600} c="var(--accent-primary)" data-testid="user-mention">
        {resolved.text}
      </Text>
    ) : (
      resolved.text
    );
  }
  const testId = `${segment.kind}-mention`;
  if (mentions && (linked === true || (linked === 'documents' && segment.kind === 'document'))) {
    const link = (
      <Anchor
        component={Link}
        to={mentionHref(mentions.roomId, segment)}
        inherit
        c="var(--accent-primary)"
        data-testid={testId}
        style={linked === 'documents' ? { position: 'relative', zIndex: 2 } : undefined}
      >
        {segment.text}
      </Anchor>
    );
    return segment.kind === 'document' ? (
      <DocumentOpenMenu roomId={mentions.roomId} documentId={segment.document.id}>
        <DocumentMentionPreview roomId={mentions.roomId} document={segment.document} tags={mentions.tags}>
          {link}
        </DocumentMentionPreview>
      </DocumentOpenMenu>
    ) : (
      link
    );
  }
  return (
    <Text span inherit c="var(--accent-primary)" data-testid={testId}>
      {segment.text}
    </Text>
  );
}

/**
 * Text with `#` mentions rendered as accent-colored links: a Document
 * mention opens the Document (and, hovered with a mouse, previews its card:
 * spec 32), a Tag mention the Documents with that Tag. A
 * token shows its target's current name; one the viewer can't resolve (a
 * hidden or deleted target) reads as plain text with its stored name.
 * Given `members`, a mention of a member is highlighted under their current
 * name; one of someone who has left reads as plain text with the name written.
 */
export function MentionText({ text, linked = true, members, ...textProps }: MentionTextProps) {
  const segments = useMentionSegments(text, members);

  // A div, not Mantine's default <p>: a Document mention's hover preview
  // renders a whole card (headings, divs, paragraphs), which can't nest in a <p>.
  return (
    <Text component="div" {...textProps}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <MentionSegmentView key={index} segment={segment} linked={linked} members={members} />
        ),
      )}
    </Text>
  );
}
