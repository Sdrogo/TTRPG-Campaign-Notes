import { useEffect, useState } from 'react';
import { Badge, Button, Group, Menu, Modal, NumberInput, Paper, Stack, Text } from '@mantine/core';
import { TimerIcon } from '@phosphor-icons/react';
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

interface TimerBarProps {
  /** When the board was read (`Date.now()`), to correct for the server's clock. */
  readAtMs: number;
}

/**
 * The shared timer (spec 46 Decision 4), sticky on top of the page: the time
 * left, counted down here from the server's end time; "Time's up" at zero
 * until the Master stops it. It blocks nothing. The Master's menu starts it
 * (5, 10, 15 minutes or a chosen length), pauses, resumes and stops it.
 * Without a timer, a Player sees no bar.
 */
export function TimerBar({ readAtMs }: TimerBarProps) {
  const { t } = useTranslation();
  const { board, act, busy, writable } = useBoard();
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState(false);
  const timer = board.timer;
  const running = timer?.state === 'running';
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

  return (
    <Paper
      withBorder
      radius="md"
      px="sm"
      py={6}
      style={{ position: 'sticky', top: 0, zIndex: 90, background: 'var(--bg-base)' }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" role="timer" aria-label={t('sessionZero.timer.label')}>
          <TimerIcon size={18} aria-hidden />
          {left === null ? (
            <Text size="sm" c="dimmed">
              {t('sessionZero.timer.none')}
            </Text>
          ) : left === 0 ? (
            <Text size="sm" fw={700} c="var(--state-warning)">
              {t('sessionZero.timer.expired')}
            </Text>
          ) : (
            <Text size="lg" fw={700} ff="monospace">
              {formatClock(left)}
            </Text>
          )}
          {timer?.state === 'paused' && (
            <Badge size="sm" variant="light" color="gray">
              {t('sessionZero.timer.paused')}
            </Badge>
          )}
        </Group>
        {manage && (
          <Menu position="bottom-end" shadow="md">
            <Menu.Target>
              <LabeledActionIcon variant="subtle" color="gray" aria-label={t('sessionZero.timer.actions')}>
                <TimerIcon size={18} />
              </LabeledActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('sessionZero.timer.start')}</Menu.Label>
              {TIMER_PRESETS_MIN.map((minutes) => (
                <Menu.Item key={minutes} disabled={busy} onClick={() => act(boardWrites.timer('start', minutes))}>
                  {t('sessionZero.timer.minutes', { count: minutes })}
                </Menu.Item>
              ))}
              <Menu.Item onClick={() => setCustom(true)}>{t('sessionZero.timer.custom')}</Menu.Item>
              {(running || timer?.state === 'paused') && <Menu.Divider />}
              {running && left !== 0 && (
                <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('pause'))}>
                  {t('sessionZero.timer.pause')}
                </Menu.Item>
              )}
              {timer?.state === 'paused' && (
                <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('resume'))}>
                  {t('sessionZero.timer.resume')}
                </Menu.Item>
              )}
              {(running || timer?.state === 'paused') && (
                <Menu.Item disabled={busy} onClick={() => act(boardWrites.timer('stop'))}>
                  {t('sessionZero.timer.stop')}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {custom && (
        <CustomTimerModal
          busy={busy}
          onClose={() => setCustom(false)}
          onStart={(minutes) => {
            act(boardWrites.timer('start', minutes));
            setCustom(false);
          }}
        />
      )}
    </Paper>
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
