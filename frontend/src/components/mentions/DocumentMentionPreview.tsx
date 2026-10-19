import { useContext, type ReactElement } from 'react';
import { HoverCard } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { DocumentCard } from '../DocumentCard';
import { useMembers } from '../../hooks/useMembers';
import { OWN_CLICKS_ATTRIBUTE } from '../documents/DocumentOpenMenu';
import { OpenMenuContext } from '../../hooks/useSideDocument';
import type { Document } from '../../types/document';
import type { Tag } from '../../types/tag';

// Long enough that sweeping the pointer across a paragraph opens nothing.
const OPEN_DELAY_MS = 400;
// Short, but long enough to move the pointer from the mention into the card.
const CLOSE_DELAY_MS = 150;
const PREVIEW_WIDTH = 440;

/** Only a precise pointer that can hover: a tap on a touch screen just follows the link. */
export const HOVER_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

interface DocumentMentionPreviewProps {
  roomId: string;
  /** The mentioned Document, from the viewer's (already filtered) Document list. */
  document: Document;
  tags: Tag[];
  /** The mention's link; it must forward its ref. */
  children: ReactElement;
  /**
   * Opens nothing for now (a map card being dragged or its open menu showing,
   * spec 37). Inside an open menu's target it also stays shut while the menu shows.
   */
  disabled?: boolean;
}

/**
 * A `#Document` mention that, while the pointer rests on it, shows the
 * Document's card from the Documents list (spec 32). Nothing on devices
 * without hover.
 */
export function DocumentMentionPreview({
  roomId,
  document,
  tags,
  children,
  disabled = false,
}: DocumentMentionPreviewProps) {
  const canHover = useMediaQuery(HOVER_POINTER_QUERY);
  const menuOpen = useContext(OpenMenuContext);
  if (!canHover) {
    return children;
  }
  return (
    <HoverCard
      disabled={disabled || menuOpen}
      openDelay={OPEN_DELAY_MS}
      closeDelay={CLOSE_DELAY_MS}
      width={PREVIEW_WIDTH}
      position="bottom-start"
      shadow="md"
    >
      <HoverCard.Target>{children}</HoverCard.Target>
      {/* The card brings its own border and background. Its clicks are its own:
          through React they'd otherwise reach the mention's open menu (spec 37),
          which would open on a carousel arrow or a Tag. */}
      <HoverCard.Dropdown
        p={0}
        bg="transparent"
        bd="none"
        {...{ [OWN_CLICKS_ATTRIBUTE]: true }}
        onClick={(event) => event.stopPropagation()}
      >
        <PreviewCard roomId={roomId} document={document} tags={tags} />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** Mounted only while the preview is open; the members query is the page's cached one. */
function PreviewCard({ roomId, document, tags }: Pick<DocumentMentionPreviewProps, 'roomId' | 'document' | 'tags'>) {
  const members = useMembers(roomId, true);
  return (
    <DocumentCard
      document={document}
      roomId={roomId}
      tags={tags}
      members={members.data ?? []}
      headingOrder={3}
    />
  );
}
