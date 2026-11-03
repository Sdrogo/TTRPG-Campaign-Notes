import { Tooltip } from '@mantine/core';
import { CheckIcon, LockSimpleIcon, MinusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { colorValue } from '../../lib/maps';
import { clockSummary, wedgeColors, wedgeDelta, wedgePath } from '../../lib/clocks';
import type { Clock, MarkKind } from '../../types/clock';

/** The face's sizes (spec 61 Decision 24): a chip, a card, the detail. */
export type ClockFaceSize = 'sm' | 'md' | 'lg';

const DIAMETERS: Record<ClockFaceSize, number> = { sm: 64, md: 96, lg: 140 };

/**
 * A clock's face (Decision 24): wedges clockwise from twelve o'clock, with a
 * gap between them; filled ones in their mark kind's colour or the clock's,
 * empty ones raised and outlined. A closed clock shows a check and a ring, a
 * lapsed one is greyed with a dash, a sequence clock waiting its turn a
 * padlock. With `onMark`, each wedge this member may act on is a button
 * (fill up to it, or empty the last filled one, Decision 7); the face is
 * never a drag target.
 */
export function ClockFace({
  clock,
  kinds,
  size = 'md',
  glowing = false,
  onMark,
}: {
  clock: Clock;
  kinds: MarkKind[];
  size?: ClockFaceSize;
  glowing?: boolean;
  onMark?: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const diameter = DIAMETERS[size];
  const r = diameter / 2;
  const colors = wedgeColors(clock, kinds);
  const summary = clockSummary(clock, kinds);
  const lapsed = clock.state === 'lapsed';
  const closed = clock.state === 'closed';
  const badge = diameter * 0.32;

  const wedges = Array.from({ length: clock.segments }, (_, index) => {
    const filled = index < clock.filled;
    const path = (
      <path
        d={wedgePath(index, clock.segments, r - 1)}
        transform="translate(1 1)"
        fill={filled ? colorValue(colors[index]) : 'var(--bg-raised)'}
        stroke="var(--bg-base)"
        strokeWidth={2}
        className={filled && glowing && index === clock.filled - 1 ? 'clock-wedge-glow' : undefined}
      />
    );
    const delta = onMark ? wedgeDelta(clock, index) : 0;
    const stage = clock.stageLabels[index];
    const label =
      delta > 0
        ? t('clocks.face.markUpTo', { count: delta })
        : t('clocks.face.emptyDown', { count: -delta });
    const wedge =
      delta !== 0 ? (
        <g
          key={index}
          role="button"
          tabIndex={0}
          aria-label={stage ? `${label} · ${stage}` : label}
          className="clock-wedge"
          onClick={() => onMark?.(delta)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onMark?.(delta);
            }
          }}
        >
          {path}
        </g>
      ) : (
        <g key={index}>{path}</g>
      );
    return stage ? (
      <Tooltip key={index} label={stage} withArrow openDelay={300}>
        {wedge}
      </Tooltip>
    ) : (
      wedge
    );
  });

  return (
    <div
      className="clock-face"
      data-size={size}
      data-state={clock.state}
      style={{ width: diameter, height: diameter, opacity: lapsed ? 0.5 : 1 }}
    >
      <svg
        width={diameter}
        height={diameter}
        viewBox={`0 0 ${diameter} ${diameter}`}
        role="img"
        aria-label={summary}
      >
        <circle cx={r} cy={r} r={r - 1} fill="var(--bg-base)" />
        {wedges}
        <circle
          cx={r}
          cy={r}
          r={r - 1}
          fill="none"
          stroke={closed ? colorValue(clock.color) : 'var(--border-default)'}
          strokeWidth={closed ? 3 : 1}
          pointerEvents="none"
        />
      </svg>
      {(closed || lapsed || clock.locked) && (
        <span
          className="clock-face-badge"
          aria-hidden="true"
          style={{ width: badge, height: badge }}
        >
          {closed && <CheckIcon size={badge * 0.6} weight="bold" />}
          {lapsed && <MinusIcon size={badge * 0.6} weight="bold" />}
          {!closed && !lapsed && clock.locked && <LockSimpleIcon size={badge * 0.6} weight="bold" />}
        </span>
      )}
    </div>
  );
}
