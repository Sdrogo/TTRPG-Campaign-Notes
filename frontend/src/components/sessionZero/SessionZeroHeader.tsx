import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  Stack,
  Text,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { DotsThreeVerticalIcon, PaperPlaneTiltIcon, TimerIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import {
  MAX_CARDS_PER_BOARD,
  TIMER_MAX_MIN,
  TIMER_MIN_MIN,
  TIMER_PRESETS_MIN,
  boardWrites,
  formatClock,
  secondsLeft,
} from '../../lib/sessionZero';
import { useBoard } from './boardContext';
import { PublishModal } from './PostItCard';
import { NewSession, SessionPicker } from './SessionPicker';

interface TimerChipProps {
  /** When the board was read (`Date.now()`), to correct for the server's clock. */
  readAtMs: number;
}

interface SessionZeroHeaderProps extends TimerChipProps {
  /** Shows another session on the Retro board; null is the open one. */
  onPick: (roundId: string | null) => void;
}

/**
 * Everything above the boards on one line (spec 46d Decision 4): the session
 * selector, which names the page, the timer chip, "Publish drafts (N)" while
 * the viewer has some and, on the right for the Master, "New session" and a
 * "⋮" to delete the Session 0. Wraps on a phone. The page's `h1` is for
 * screen readers only: the selector already says which session this is.
 */
export function SessionZeroHeader({ readAtMs, onPick }: SessionZeroHeaderProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [deleting, setDeleting] = useState(false);
  const manage = writable && board.canManage;
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  return (
    <Group gap="xs" className="sz-header">
      <VisuallyHidden>
        <Title order={1}>{t('sessionZero.title')}</Title>
      </VisuallyHidden>
      <SessionPicker onPick={onPick} />
      <TimerChip readAtMs={readAtMs} />
      {writable && open && <PublishAll />}
      {manage && (
        <Group gap="xs" wrap="nowrap" ml="auto">
          {open && <NewSession />}
          <Menu position="bottom-end" shadow="md">
            <Menu.Target>
              <LabeledActionIcon variant="subtle" color="gray" aria-label={t('sessionZero.actions')}>
                <DotsThreeVerticalIcon size={20} />
              </LabeledActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="red" onClick={() => setDeleting(true)}>
                {t('sessionZero.delete.action')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}
      {deleting && (
        <Modal opened onClose={() => setDeleting(false)} title={t('sessionZero.delete.title')} centered>
          <Stack>
            <Text size="sm">{t('sessionZero.delete.body')}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleting(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                disabled={busy}
                onClick={() => act(boardWrites.deleteSessionZero(), () => setDeleting(false))}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Group>
  );
}

/**
 * "Publish drafts (N)" while the viewer has drafts in the open session (spec
 * 46c Decision 8), in the header so nothing below moves when it comes and
 * goes (spec 46d Decision 4): one dialog, one signed or anonymous choice for
 * all of them. Drafts past the board's limit stay drafts, and the dialog
 * says how many.
 */
function PublishAll() {
  const { t } = useTranslation();
  const { board, act, busy } = useBoard();
  const [asking, setAsking] = useState(false);
  const cards = board.retro.flatMap((column) => column.cards);
  const drafts = cards.filter((card) => card.canPublish).length;
  if (drafts === 0) return null;
  const room = MAX_CARDS_PER_BOARD - cards.filter((card) => !card.draft).length;
  const staying = Math.max(0, drafts - Math.max(0, room));
  return (
    <>
      <Button size="compact-sm" leftSection={<PaperPlaneTiltIcon size={14} />} onClick={() => setAsking(true)}>
        {t('sessionZero.publishAll.button', { count: drafts })}
      </Button>
      {asking && (
        <PublishModal
          title={t('sessionZero.publishAll.title')}
          body={
            <>
              {t('sessionZero.publishAll.body', { count: drafts })}
              {staying > 0 && ` ${t('sessionZero.publishAll.overLimit', { count: staying })}`}
            </>
          }
          busy={busy}
          onClose={() => setAsking(false)}
          onPublish={(anonymous) => act(boardWrites.publishAll(anonymous), () => setAsking(false))}
        />
      )}
    </>
  );
}

/**
 * The shared timer (spec 46 Decision 4) as a chip on the title line (spec
 * 46c Decision 2): the time left, counted down here from the server's end
 * time; "Time's up" at zero until the Master stops it. It blocks nothing.
 * For the Master the chip opens the timer menu (5, 10, 15 minutes or a
 * chosen length, pause, resume, stop), and without a timer it is the clock
 * icon alone; a Player sees nothing without a timer.
 */
function TimerChip({ readAtMs }: TimerChipProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState(false);
  const timer = board.timer;
  const running = timer?.state === 'running';
  const paused = timer?.state === 'paused';
  // `now` stands still while the timer does: a board read since then (a
  // start or resume) is the later clock reading until the next tick.
  const left = timer ? secondsLeft(timer, Math.max(now, readAtMs), readAtMs) : null;
  const manage = writable && board.canManage;

  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [running]);

  if (left === null && !manage) return null;

  const shown =
    left === null ? null : left === 0 ? (
      <Text span size="sm" fw={700} c="var(--state-warning)">
        {t('sessionZero.timer.expired')}
      </Text>
    ) : (
      <Text span size="sm" fw={700} ff="monospace">
        {formatClock(left)}
        {paused && (
          <Text span size="xs" fw={400} c="dimmed" ff="var(--font-body)" ml={6}>
            {t('sessionZero.timer.paused')}
          </Text>
        )}
      </Text>
    );
  const chip = (
    <Group gap={6} wrap="nowrap">
      <TimerIcon size={16} aria-hidden />
      {shown}
    </Group>
  );
  const chipStyle = {
    padding: '2px 10px',
    borderRadius: 999,
    border: '1px solid var(--border-default)',
    background: 'var(--bg-raised)',
  };

  if (!manage) {
    return (
      <div role="timer" aria-label={t('sessionZero.timer.label')} style={chipStyle}>
        {chip}
      </div>
    );
  }
  return (
    <>
      <Menu position="bottom-start" shadow="md">
        <Menu.Target>
          <UnstyledButton
            aria-label={t('sessionZero.timer.actions')}
            style={chipStyle}
          >
            <span role="timer" aria-label={t('sessionZero.timer.label')}>
              {chip}
            </span>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t('sessionZero.timer.start')}</Menu.Label>
          {TIMER_PRESETS_MIN.map((minutes) => (
            <Menu.Item key={minutes} disabled={busy} onClick={() => act(boardWrites.timer('start', minutes))}>
              {t('sessionZero.timer.minutes', { count: minutes })}
            </Menu.Item>
          ))}
          <Menu.Item onClick={() => setCustom(true)}>{t('sessionZero.timer.custom')}</Menu.Item>
          {(running || paused) && <Menu.Divider />}
          {running && left !== 0 && (
            <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('pause'))}>
              {t('sessionZero.timer.pause')}
            </Menu.Item>
          )}
          {paused && (
            <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('resume'))}>
              {t('sessionZero.timer.resume')}
            </Menu.Item>
          )}
          {(running || paused) && (
            <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('stop'))}>
              {t('sessionZero.timer.stop')}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      {custom && (
        <CustomTimerModal
          busy={busy}
          onClose={() => setCustom(false)}
          // The dialog stays open until the timer has started (review of PR #251).
          onStart={(minutes) => act(boardWrites.timer('start', minutes), () => setCustom(false))}
        />
      )}
    </>
  );
}

interface CustomTimerModalProps {
  busy: boolean;
  onClose: () => void;
  onStart: (minutes: number) => void;
}

/** A timer of the Master's chosen length, 1 to 60 minutes. */
function CustomTimerModal({ busy, onClose, onStart }: CustomTimerModalProps) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState<number | string>(20);
  const valid = typeof minutes === 'number' && minutes >= TIMER_MIN_MIN && minutes <= TIMER_MAX_MIN;
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.timer.custom')} centered>
      <Stack>
        <NumberInput
          label={t('sessionZero.timer.length')}
          description={t('sessionZero.timer.lengthHint', { min: TIMER_MIN_MIN, max: TIMER_MAX_MIN })}
          value={minutes}
          onChange={setMinutes}
          min={TIMER_MIN_MIN}
          max={TIMER_MAX_MIN}
          allowDecimal={false}
          allowNegative={false}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid || busy} onClick={() => onStart(minutes as number)}>
            {t('sessionZero.timer.startButton')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
