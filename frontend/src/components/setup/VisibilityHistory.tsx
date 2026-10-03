import { useState } from 'react';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { VisibilityBadge } from '../VisibilityBadge';
import { useVisibilityHistory } from '../../hooks/useReveals';
import { displayNameFor } from '../../lib/members';
import { formatAbsoluteTime } from '../../lib/time';
import type { Member } from '../../types/member';
import type { ContentKind, HistoryEntry } from '../../types/reveal';

const FILTERS = ['all', 'document', 'note', 'comment'] as const;
type Filter = (typeof FILTERS)[number];

interface VisibilityHistoryProps {
  roomId: string;
  members: Member[];
}

/**
 * The Room's visibility history (spec 22 Decision 4, FR-V5, VR-08), for the
 * Master and the Administrators: who changed who sees what, when, from which
 * level to which, Reveals marked as such, newest first, filterable by kind of
 * content. A table on wide screens, a list on a phone. Content the reader
 * can't see, or that is gone, is named only by its kind (VR-07).
 */
export function VisibilityHistory({ roomId, members }: VisibilityHistoryProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const history = useVisibilityHistory(
    roomId,
    filter === 'all' ? null : (filter as ContentKind),
    true,
  );
  const entries = history.data ?? [];

  return (
    <Stack gap="sm">
      <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.history.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.history.description')}
      </Text>
      <SegmentedControl
        aria-label={t('setup.history.filterLabel')}
        value={filter}
        onChange={(value) => setFilter(value as Filter)}
        data={FILTERS.map((value) => ({ value, label: t(`setup.history.filter.${value}`) }))}
        style={{ alignSelf: 'flex-start' }}
      />

      {history.isLoading ? (
        <Loader color="accent" />
      ) : history.isError ? (
        <Text c="red">{t('setup.history.loadError')}</Text>
      ) : entries.length === 0 ? (
        <Text size="sm">{t('setup.history.empty')}</Text>
      ) : (
        <>
          <Box visibleFrom="sm">
            <Table verticalSpacing="xs" data-testid="history-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('setup.history.when')}</Table.Th>
                  <Table.Th>{t('setup.history.who')}</Table.Th>
                  <Table.Th>{t('setup.history.what')}</Table.Th>
                  <Table.Th>{t('setup.history.change')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entries.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>
                      <When entry={entry} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{displayNameFor(members, entry.actorId)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <What roomId={roomId} entry={entry} />
                    </Table.Td>
                    <Table.Td>
                      <Change entry={entry} members={members} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
          <Stack
            hiddenFrom="sm"
            component="ul"
            gap="xs"
            p={0}
            m={0}
            style={{ listStyle: 'none' }}
            data-testid="history-list"
          >
            {entries.map((entry) => (
              <Paper key={entry.id} component="li" withBorder p="xs" radius="md">
                <Stack gap={4}>
                  <What roomId={roomId} entry={entry} />
                  <Change entry={entry} members={members} />
                  <Text size="xs" c="dimmed">
                    {displayNameFor(members, entry.actorId)} · <When entry={entry} />
                  </Text>
                </Stack>
              </Paper>
            ))}
          </Stack>
          {history.hasNextPage && (
            <Button
              variant="subtle"
              color="gray"
              loading={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('setup.history.loadMore')}
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

function When({ entry }: { entry: HistoryEntry }) {
  return (
    <Text span inherit size="sm" component="time" dateTime={entry.createdAt}>
      {formatAbsoluteTime(entry.createdAt)}
    </Text>
  );
}

// The content, linked to where it is; only its kind when the reader can't see it.
function What({ roomId, entry }: { roomId: string; entry: HistoryEntry }) {
  const { t } = useTranslation();
  if (entry.state !== 'visible') {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        {t(`setup.history.${entry.state}.${entry.kind}`)}
      </Text>
    );
  }
  const document = entry.documentName;
  const label =
    entry.kind === 'note'
      ? t('setup.history.note', { title: entry.noteTitle, document })
      : entry.kind === 'comment'
        ? t('setup.history.comment', { document })
        : document;
  const anchor = entry.commentId ? `#comment-${entry.commentId}` : '';
  return (
    <Anchor
      component={Link}
      to={`/rooms/${roomId}/documents/${entry.documentId}${anchor}`}
      size="sm"
      style={{ overflowWrap: 'anywhere' }}
    >
      {label}
    </Anchor>
  );
}

// Before and after, a Reveal marked so, and who it let in or was chosen.
function Change({ entry, members }: { entry: HistoryEntry; members: Member[] }) {
  const { t } = useTranslation();
  const names = (ids: string[]) => ids.map((id) => displayNameFor(members, id)).join(', ');
  return (
    <Stack gap={4}>
      <Group gap={6} wrap="wrap">
        <VisibilityBadge visibility={entry.fromVisibility} size="xs" />
        <ArrowRightIcon size={12} aria-hidden="true" />
        <VisibilityBadge visibility={entry.toVisibility} size="xs" />
        {entry.isReveal && (
          <Badge size="xs" variant="filled" color="accent">
            {t('setup.history.reveal')}
          </Badge>
        )}
      </Group>
      {entry.recipientIds.length > 0 && (
        <Text size="xs" c="dimmed">
          {t('setup.history.recipients', { names: names(entry.recipientIds) })}
        </Text>
      )}
      {entry.toVisibility === 'selective' && entry.selectiveUserIds.length > 0 && (
        <Text size="xs" c="dimmed">
          {t('setup.history.selective', { names: names(entry.selectiveUserIds) })}
        </Text>
      )}
    </Stack>
  );
}
