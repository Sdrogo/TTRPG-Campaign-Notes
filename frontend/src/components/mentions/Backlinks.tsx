import { useState } from 'react';
import { Anchor, Badge, Collapse, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBacklinks } from '../../hooks/useBacklinks';
import { backlinkHref } from '../../lib/backlinks';
import { displayNameFor } from '../../lib/members';
import { PageCard } from '../PageCard';
import type { Backlink, BacklinkTarget } from '../../types/backlink';
import type { Member } from '../../types/member';

interface BacklinksProps {
  roomId: string;
  target: BacklinkTarget;
  members: Member[];
}

/**
 * "Mentioned in" (spec 20 Decisions 4, 6 and 8): the Documents that mention
 * a Document or a Tag, each with where it does (the description, a Note, a
 * Comment) and the text around it. The backend already left out what the
 * viewer may not see. Collapsible, and not shown at all while empty.
 */
export function Backlinks({ roomId, target, members }: BacklinksProps) {
  const { t } = useTranslation();
  const backlinks = useBacklinks(roomId, target);
  const [expanded, setExpanded] = useState(true);
  const groups = backlinks.data ?? [];

  if (groups.length === 0) {
    return null;
  }

  const count = groups.reduce((total, group) => total + group.mentions.length, 0);
  const where = (mention: Backlink) => {
    if (mention.kind === 'note') {
      return t('backlinks.inNote', { title: mention.noteTitle });
    }
    if (mention.kind === 'comment') {
      return t('backlinks.inComment', { name: displayNameFor(members, mention.commentAuthorId!) });
    }
    return t('backlinks.inDescription');
  };

  return (
    <PageCard>
      <Stack gap="md" data-testid="backlinks">
        <UnstyledButton
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          style={{ alignSelf: 'flex-start' }}
        >
          <Group gap="xs">
            {expanded ? (
              <CaretDownIcon size={16} aria-hidden="true" />
            ) : (
              <CaretRightIcon size={16} aria-hidden="true" />
            )}
            <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
              {t('backlinks.title')}
            </Title>
            <Badge variant="light" color="gray">
              {count}
            </Badge>
          </Group>
        </UnstyledButton>
        <Collapse expanded={expanded}>
          <Stack gap="md">
            {groups.map((group) => (
              <Stack key={group.documentId} gap={6}>
                <Anchor
                  component={Link}
                  to={`/rooms/${roomId}/documents/${group.documentId}`}
                  fw={600}
                  c="var(--accent-primary)"
                >
                  {group.documentName}
                </Anchor>
                {group.mentions.map((mention, index) => (
                  <Stack
                    key={index}
                    gap={2}
                    pl="sm"
                    style={{ borderLeft: '2px solid var(--border-default)' }}
                  >
                    <Anchor
                      component={Link}
                      to={backlinkHref(roomId, group.documentId, mention)}
                      size="xs"
                      c="dimmed"
                    >
                      {where(mention)}
                    </Anchor>
                    <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                      {mention.excerpt}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Stack>
    </PageCard>
  );
}
