import { Anchor, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { UNDO_TOAST_MS } from '../lib/clocks';
import { notifyError } from '../lib/notify';
import type { Clock } from '../types/clock';
import { useMarkClock, useUndoMark, type MarkInput } from './useClocks';

/**
 * Marks a clock and shows the marker a 5 s toast, "+1 su «Allarme» ·
 * Annulla" (spec 61 Decision 9). "Annulla" takes back that mark, even under
 * "Non si torna indietro": it is a correction, logged as one.
 */
export function useClockMarker(roomId: string) {
  const { t } = useTranslation();
  const markClock = useMarkClock(roomId);
  const undoMark = useUndoMark(roomId);

  const mark = (clock: Clock, input: Omit<MarkInput, 'clockId'>) =>
    markClock.mutate(
      { ...input, clockId: clock.id },
      {
        onError: notifyError,
        onSuccess: ({ clock: after, markId }) => {
          const applied = after.filled - clock.filled;
          if (applied === 0) return;
          const id = `clock-mark-${markId}`;
          notifications.show({
            id,
            autoClose: UNDO_TOAST_MS,
            message: (
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text size="sm">
                  {t('clocks.toast.marked', {
                    delta: applied > 0 ? `+${applied}` : String(applied),
                    name: clock.name,
                  })}
                </Text>
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  onClick={() => {
                    notifications.hide(id);
                    undoMark.mutate({ clockId: clock.id, markId }, { onError: notifyError });
                  }}
                >
                  {t('clocks.toast.undo')}
                </Anchor>
              </Group>
            ),
          });
        },
      },
    );

  return { mark, pending: markClock.isPending || undoMark.isPending };
}
