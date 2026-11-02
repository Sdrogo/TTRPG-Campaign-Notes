import { useState, type ReactNode } from 'react';
import { Badge, Box, Collapse, Group, Loader, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LandingCard } from './LandingCard';
import { DocumentCard } from '../DocumentCard';
import { useTags } from '../../hooks/useTags';
import { useMembers } from '../../hooks/useMembers';
import { useMyReveals } from '../../hooks/useReveals';
import { useReadOnly } from '../../hooks/useViewAs';
import { hasUnseenReveal } from '../../lib/reveal';
import { isBlockEmpty, type BlockContent } from './blockItems';
import { blockAnchor, sessionZeroHref, type SessionZeroItem } from '../../lib/landing';
import { linesVeilsLine, pollLine, sessionLine, stepLine, stepTitle } from '../../lib/landingText';
import { moduleLabel, roundLabel } from '../../lib/sessionZero';
import { useBackState } from '../../lib/backNav';
import type { LandingBlock } from '../../types/landing';

interface SectionBlockProps {
  roomId: string;
  block: LandingBlock;
  heading: string;
  /** Undefined while its items load. */
  content: BlockContent | undefined;
  /** The Master sees an empty block ("Niente da mostrare"); the others don't. */
  isMaster: boolean;
  /** Edit mode's block bar, in place of the heading. */
  bar?: ReactNode;
  /** Edit mode's handle beside each sub-section heading, by its key. */
  partHandle?: (key: string) => ReactNode;
  /** Wraps the sub-sections, so edit mode can make them sortable. */
  wrapParts?: (parts: ReactNode[], keys: string[]) => ReactNode;
}

/**
 * One block of a custom Section (spec 55, Terms): its heading, then its
 * cards in the Documents page's grid, split into foldable sub-sections (a
 * Documents block's groups, a Session 0 block's features) when it has them.
 * Items keep their own visibility: a block with nothing the viewer sees is
 * left out, except for the Master, who reads "Niente da mostrare".
 */
export function SectionBlock({ roomId, block, heading, content, isMaster, bar, partHandle, wrapParts }: SectionBlockProps) {
  const { t } = useTranslation();
  const backState = useBackState();
  // A Documents block shows the Documents page's own cards (product owner,
  // 2026-11-02, spec 57c), with the Tags, members and reveal marks they need.
  const hasDocuments = content?.kind === 'documents';
  const tags = useTags(roomId, hasDocuments);
  const members = useMembers(roomId, hasDocuments);
  const readOnly = useReadOnly();
  const reveals = useMyReveals(hasDocuments && !readOnly);
  const empty = isBlockEmpty(content);
  if (empty && !isMaster) return null;

  const grid = (cards: ReactNode[]) => <Box className="documents-grid">{cards}</Box>;
  const sessionCard = (item: SessionZeroItem) => {
    switch (item.kind) {
      case 'session':
        return (
          <LandingCard
            key={item.key}
            to={sessionZeroHref(roomId, item.round.id)}
            state={backState}
            title={roundLabel(item.round)}
            description={sessionLine(item.round.startedAt, item.round.steps)}
            badge={item.round.closedAt ? null : t('roomLanding.item.inProgress')}
          />
        );
      case 'step':
        return (
          <LandingCard
            key={item.key}
            to={sessionZeroHref(roomId, item.round.id, item.step.id)}
            state={backState}
            title={stepTitle(item.step, item.round)}
            description={stepLine(item.step, isMaster)}
          />
        );
      case 'linesVeils':
        return (
          <LandingCard
            key={item.key}
            to={sessionZeroHref(roomId)}
            state={backState}
            title={moduleLabel('lines_veils')}
            description={linesVeilsLine(item.counts)}
          />
        );
      default:
        return (
          <LandingCard
            key={item.key}
            to={sessionZeroHref(roomId, item.round.id, item.step.id)}
            state={backState}
            title={item.poll.body}
            description={pollLine(item.poll)}
          />
        );
    }
  };

  let body: ReactNode;
  if (!content) {
    body = <Loader size="sm" color="accent" />;
  } else if (empty) {
    body = (
      <Text c="dimmed" size="sm">
        {t('roomLanding.blockEmpty')}
      </Text>
    );
  } else if (content.kind === 'maps') {
    body = grid(
      content.maps.map((map) => (
        <LandingCard
          key={map.id}
          to={`/rooms/${roomId}/maps/${map.id}`}
          state={backState}
          title={map.name}
          description={map.description || t(map.kind === 'geographic' ? 'roomLanding.mapKinds.geographic' : 'roomLanding.mapKinds.free')}
        />
      )),
    );
  } else {
    const parts =
      content.kind === 'documents'
        ? content.parts.map((part) => ({
            key: part.key,
            label: part.label,
            count: part.documents.length,
            cards: part.documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                roomId={roomId}
                tags={tags.data ?? []}
                members={members.data ?? []}
                headingOrder={3}
                revealed={hasUnseenReveal(reveals.data, document.id)}
                mentionLinks
              />
            )),
          }))
        : content.parts.map((part) => ({
            key: part.key,
            label: part.label,
            count: part.items.length,
            cards: part.items.map(sessionCard),
          }));
    const rendered = parts.map((part) =>
      part.label === null ? (
        <Box key={part.key}>{grid(part.cards)}</Box>
      ) : (
        <BlockPart key={part.key} label={part.label} count={part.count} handle={partHandle?.(part.key)}>
          {grid(part.cards)}
        </BlockPart>
      ),
    );
    body = <Stack gap="md">{wrapParts ? wrapParts(rendered, parts.map((part) => part.key)) : rendered}</Stack>;
  }

  return (
    <Stack component="section" gap="sm" id={blockAnchor(block.id)} className="room-landing-block" aria-label={heading}>
      {bar ?? (
        <Title order={2} fz="h4" style={{ fontFamily: 'var(--font-display)' }}>
          {heading}
        </Title>
      )}
      {body}
    </Stack>
  );
}

/** A sub-section of a block: a heading that folds its cards, like a Documents page group (starts open, not remembered). */
function BlockPart({ label, count, handle, children }: { label: string; count: number; handle?: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Stack gap="xs" className="document-group">
      <Group gap={4} wrap="nowrap">
        {handle}
        <Title order={3} fz="h5" style={{ fontFamily: 'var(--font-display)' }}>
          <UnstyledButton
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            c="dimmed"
            className="document-group-toggle"
          >
            <Group gap="xs" wrap="nowrap">
              {expanded ? <CaretDownIcon size={18} aria-hidden="true" /> : <CaretRightIcon size={18} aria-hidden="true" />}
              <Text component="span" inherit>
                {label}
              </Text>
            </Group>
            <Badge size="sm" variant="light" color="gray" circle aria-hidden="true">
              {count}
            </Badge>
          </UnstyledButton>
        </Title>
      </Group>
      <Collapse expanded={expanded}>{children}</Collapse>
    </Stack>
  );
}
