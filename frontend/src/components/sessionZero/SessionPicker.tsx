import { useState } from 'react';
import { Badge, Button, Group, Modal, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MAX_ROUND_TITLE_LENGTH, boardWrites, defaultRoundName, roundLabel } from '../../lib/sessionZero';
import type { ChainStep } from '../../types/sessionZero';
import { ChainEditor } from './ModuleChain';
import { useBoard } from './boardContext';

interface SessionPickerProps {
  /** Shows another session on the Retro board; null is the open one. */
  onPick: (roundId: string | null) => void;
}

/**
 * The header's session selector (spec 46d Decision 4), standing in for the
 * page title: the session shown, by name, and the others to pick from (spec
 * 46 Decision 16). A closed one carries a "Closed" badge: it is read-only.
 */
export function SessionPicker({ onPick }: SessionPickerProps) {
  const { t } = useTranslation();
  const { board } = useBoard();
  const shown = board.rounds.find((round) => round.id === board.roundId);
  return (
    <Group gap={6} wrap="nowrap">
      <Select
        aria-label={t('sessionZero.rounds.pick')}
        className="sz-session-picker"
        w={220}
        allowDeselect={false}
        comboboxProps={{ width: 280, position: 'bottom-start' }}
        value={board.roundId}
        data={[...board.rounds].reverse().map((round) => ({ value: round.id, label: roundLabel(round) }))}
        onChange={(value) => {
          const picked = board.rounds.find((round) => round.id === value)!;
          onPick(picked.closedAt === null ? null : picked.id);
        }}
      />
      {shown?.closedAt != null && (
        <Tooltip label={t('sessionZero.rounds.closed')} withArrow multiline maw={260}>
          <Badge color="gray" variant="light" tabIndex={0}>
            {t('sessionZero.rounds.closedBadge')}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

/**
 * The Master's "New session" (spec 46d Decision 3): the session on screen
 * closes, its unpublished drafts go. Its chain is the Master's, the open
 * session's proposed (spec 47 Decision 2); each step starts empty unless
 * the Master ticks "Carry over from the previous session" (spec 47b). Its name
 * is free, prefilled with the next default ("Session 0.5 #N"); left as it is,
 * nothing is stored and the default shows in each viewer's language.
 */
export function NewSession() {
  const { t } = useTranslation();
  const { board, act, busy } = useBoard();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button size="compact-sm" variant="default" leftSection={<PlusIcon size={14} />} onClick={() => setOpened(true)}>
        {t('sessionZero.rounds.start')}
      </Button>
      {opened && (
        <NewSessionModal
          suggested={defaultRoundName(board.rounds.length + 1)}
          chain={board.modules.map((module) => ({ kind: module.kind, carry: false }))}
          busy={busy}
          onClose={() => setOpened(false)}
          onStart={(title, modules) => {
            act(boardWrites.startRound(title, modules));
            setOpened(false);
          }}
        />
      )}
    </>
  );
}

interface NewSessionModalProps {
  suggested: string;
  chain: ChainStep[];
  busy: boolean;
  onClose: () => void;
  onStart: (title: string, modules: ChainStep[]) => void;
}

function NewSessionModal({ suggested, chain: proposed, busy, onClose, onStart }: NewSessionModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(suggested);
  const [chain, setChain] = useState(proposed);
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.rounds.start')} centered>
      <Stack>
        <Text size="sm">{t('sessionZero.rounds.startBody')}</Text>
        <TextInput
          label={t('sessionZero.rounds.title')}
          value={name}
          maxLength={MAX_ROUND_TITLE_LENGTH}
          onChange={(event) => setName(event.currentTarget.value)}
          data-autofocus
        />
        <ChainEditor value={chain} onChange={setChain} carry />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => onStart(name.trim() === suggested ? '' : name, chain)}>
            {t('sessionZero.rounds.startButton')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
