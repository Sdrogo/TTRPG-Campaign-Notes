import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_ROUND_TITLE_LENGTH, boardWrites, roundLabel } from '../../lib/sessionZero';
import { useBoard } from './boardContext';

interface RoundsBarProps {
  /** Shows another round on the Retro board; null is the open one. */
  onPick: (roundId: string | null) => void;
}

/**
 * Above the Retro board (spec 46 Decision 16): the round selector once there
 * is more than one round ("Session 0", "Session 0.5 #1 · End of arc 1"...), a
 * dimmed notice on a closed round, read-only, and the Master's "Start Session
 * 0.5", which asks first.
 */
export function RoundsBar({ onPick }: RoundsBarProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [starting, setStarting] = useState(false);
  const shown = board.rounds.find((round) => round.id === board.roundId);
  const closed = shown?.closedAt != null;

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap" gap="xs">
        {board.rounds.length > 1 ? (
          <Select
            aria-label={t('sessionZero.rounds.pick')}
            size="xs"
            w={260}
            allowDeselect={false}
            value={board.roundId}
            data={[...board.rounds].reverse().map((round) => ({ value: round.id, label: roundLabel(round) }))}
            onChange={(value) => {
              const picked = board.rounds.find((round) => round.id === value)!;
              onPick(picked.closedAt === null ? null : picked.id);
            }}
          />
        ) : (
          <Text size="sm" fw={600}>
            {shown && roundLabel(shown)}
          </Text>
        )}
        {writable && board.canManage && !closed && (
          <Button size="compact-sm" variant="default" onClick={() => setStarting(true)}>
            {t('sessionZero.rounds.start')}
          </Button>
        )}
      </Group>
      {closed && (
        <Alert color="gray" variant="light" p="xs">
          {t('sessionZero.rounds.closed')}
        </Alert>
      )}
      {starting && (
        <StartRoundModal
          busy={busy}
          onClose={() => setStarting(false)}
          onStart={(title) => {
            act(boardWrites.startRound(title));
            setStarting(false);
          }}
        />
      )}
    </Stack>
  );
}

interface StartRoundModalProps {
  busy: boolean;
  onClose: () => void;
  onStart: (title: string) => void;
}

/** Decision 16: the round on screen closes, its unpublished drafts go, the new one keeps its columns. */
function StartRoundModal({ busy, onClose, onStart }: StartRoundModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.rounds.start')} centered>
      <Stack>
        <Text size="sm">{t('sessionZero.rounds.startBody')}</Text>
        <TextInput
          label={t('sessionZero.rounds.title')}
          placeholder={t('sessionZero.rounds.titlePlaceholder')}
          value={title}
          maxLength={MAX_ROUND_TITLE_LENGTH}
          onChange={(event) => setTitle(event.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => onStart(title)}>
            {t('sessionZero.rounds.startButton')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
