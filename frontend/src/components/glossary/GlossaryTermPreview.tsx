import { useState, type ReactNode } from 'react';
import { Anchor, Badge, Box, Group, HoverCard, Popover, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DocumentMentionsContext, useDocumentMentions } from '../../hooks/useDocumentMentions';
import { MarkdownText } from '../mentions/MarkdownText';
import { HOVER_POINTER_QUERY } from '../mentions/DocumentMentionPreview';
import { glossaryEntryHref } from '../../lib/glossary';
import type { GlossaryEntry } from '../../types/glossary';
import type { Tag } from '../../types/tag';

const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 150;
const PREVIEW_WIDTH = 380;

interface GlossaryTermPreviewProps {
  roomId: string;
  entry: GlossaryEntry;
  tags: Tag[];
  /** The term as written in the text. */
  children: ReactNode;
}

/**
 * A Glossary term highlighted in a text (spec 79 Decisions 10 and 11): its own
 * color and a dotted underline, and a card with the definition. A mouse opens
 * it by resting on the term; on a touch screen a tap opens and closes it.
 */
export function GlossaryTermPreview({ roomId, entry, tags, children }: GlossaryTermPreviewProps) {
  const canHover = useMediaQuery(HOVER_POINTER_QUERY);
  const [opened, setOpened] = useState(false);
  const term = (
    <Text
      span
      inherit
      className="glossary-term"
      data-testid="glossary-term"
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpened((now) => !now);
        }
      }}
    >
      {children}
    </Text>
  );
  const card = <PreviewCard roomId={roomId} entry={entry} tags={tags} />;

  if (canHover) {
    return (
      <HoverCard
        openDelay={OPEN_DELAY_MS}
        closeDelay={CLOSE_DELAY_MS}
        width={PREVIEW_WIDTH}
        position="bottom-start"
        shadow="md"
        withinPortal
      >
        <HoverCard.Target>{term}</HoverCard.Target>
        <HoverCard.Dropdown p="sm">{card}</HoverCard.Dropdown>
      </HoverCard>
    );
  }
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width="min(380px, 90vw)"
      position="bottom-start"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <Box component="span" onClick={() => setOpened((now) => !now)}>
          {term}
        </Box>
      </Popover.Target>
      <Popover.Dropdown p="sm">{card}</Popover.Dropdown>
    </Popover>
  );
}

function PreviewCard({ roomId, entry, tags }: Omit<GlossaryTermPreviewProps, 'children'>) {
  const { t } = useTranslation();
  const mentions = useDocumentMentions();
  const entryTags = tags.filter((tag) => entry.tagIds.includes(tag.id));
  // The definition doesn't highlight terms again: inside its own card the
  // same word would open another card.
  const plainMentions = mentions ? { ...mentions, glossary: [] } : null;
  return (
    <Stack gap="xs" data-testid="glossary-preview">
      <Box>
        <Title order={4} ff="var(--font-display)" c="var(--accent-glossary)">
          {entry.term}
        </Title>
        {entry.aliases.length > 0 && (
          <Text size="xs" c="dimmed">
            {entry.aliases.join(', ')}
          </Text>
        )}
      </Box>
      {entry.definition.trim() !== '' && (
        <DocumentMentionsContext value={plainMentions}>
          <MarkdownText text={entry.definition} fz="sm" />
        </DocumentMentionsContext>
      )}
      {entryTags.length > 0 && (
        <Group gap={4}>
          {entryTags.map((tag) => (
            <Badge key={tag.id} variant="light" color="gray" size="sm" tt="none">
              #{tag.name}
            </Badge>
          ))}
        </Group>
      )}
      {entry.documents.length > 0 && (
        <Group gap="xs">
          {entry.documents.map((document) => (
            <Anchor
              key={document.id}
              component={Link}
              to={`/rooms/${roomId}/documents/${document.id}`}
              size="sm"
            >
              {document.name}
            </Anchor>
          ))}
        </Group>
      )}
      <Anchor component={Link} to={glossaryEntryHref(roomId, entry.id)} size="xs">
        {t('glossary.page.openEntry')}
      </Anchor>
    </Stack>
  );
}
