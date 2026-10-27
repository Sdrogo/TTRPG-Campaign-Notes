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
} from '@mantine/core';
import { DotsThreeVerticalIcon, TimerIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import {
  TIMER_MAX_MIN,
  TIMER_MIN_MIN,
  TIMER_PRESETS_MIN,
  boardWrites,
  formatClock,
  secondsLeft,
} from '../../lib/sessionZero';
import { useBoard } from './boardContext';

interface SessionZeroTitleProps {
  /** When the board was read (`Date.now()`), to correct for the server's clock. */
  readAtMs: number;
}

/**
 * The page's title row (spec 46c Decisions 2 and 3): "Session 0", the timer
 * chip on the same line and, for the Master, a "⋮" to delete the Session 0.
 */
export function SessionZeroTitle({ readAtMs }: SessionZeroTitleProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [deleting, setDeleting] = useState(false);
  const manage = writable && board.canManage;
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="sm" wrap="wrap" style={{ minWidth: 0 }}>
        <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
          {t('sessionZero.title')}
        </Title>
        <TimerChip readAtMs={readAtMs} />
      </Group>
      {manage && (
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
 * The shared timer (spec 46 Decision 4) as a chip on the title line (spec
 * 46c Decision 2): the time left, counted down here from the server's end
 * time; "Time's up" at zero until the Master stops it. It blocks nothing.
 * For the Master the chip opens the timer menu (5, 10, 15 minutes or a
 * chosen length, pause, resume, stop), and without a timer it is the clock
 * icon alone; a Player sees nothing without a timer.
 */
function TimerChip({ readAtMs }: SessionZeroTitleProps) {
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
