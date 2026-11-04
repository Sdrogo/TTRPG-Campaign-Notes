import { Button, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useClockHistory } from '../../hooks/useClocks';
import { formatRelativeTime } from '../../lib/time';
import { historyLine } from '../../lib/clocks';
import type { Clock, MarkKind } from '../../types/clock';
import type { Member } from '../../types/member';
import { SectionLoader } from '../PageState';

/**
 * A clock's history (spec 61 Decision 10), 50 lines at a time, newest first:
 * "Marco · Successo +2 · 4/8 · forzata la serratura · 21:14". The server
 * leaves the Master's fields out of a Player's lines.
 */
export function ClockHistoryModal({
  roomId,
  clock,
  kinds,
  members,
  onClose,
}: {
  roomId: string;
  clock: Clock;
  kinds: MarkKind[];
  members: Member[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const history = useClockHistory(roomId, clock.id);
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <Modal opened onClose={onClose} closeOnClickOutside={false} title={t('clocks.history.title', { name: clock.name })} centered>
      {history.isPending && <SectionLoader />}
      {history.isError && <Text c="red">{t('clocks.history.loadError')}</Text>}
      <Stack gap={6} component="ol" className="clock-history" p={0} m={0}>
        {entries.map((entry) => (
          <Text key={entry.id} component="li" size="sm">
            {historyLine(entry, kinds, members)}
            <Text span size="xs" c="dimmed">
              {' · '}
              {formatRelativeTime(entry.createdAt)}
            </Text>
          </Text>
        ))}
      </Stack>
      {history.hasNextPage && (
        <Button
          variant="subtle"
          mt="sm"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t('clocks.history.more')}
        </Button>
      )}
    </Modal>
  );
}
