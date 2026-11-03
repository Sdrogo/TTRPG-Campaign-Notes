import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toClock, toRules } from '../../../lib/clocks';
import { rawClock, rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockFace } from '../../../components/clocks/ClockFace';

const kinds = toRules(rawRules()).markKinds;
const clock = (overrides: Parameters<typeof rawClock>[0] = {}) => toClock(rawClock(overrides));

describe('ClockFace', () => {
  it('reads as one picture with its summary when it takes no marks', () => {
    const { container } = renderWithProviders(<ClockFace clock={clock()} kinds={kinds} />);
    expect(screen.getByRole('img', { name: 'Allarme: 4 su 8, Aperto' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('path')).toHaveLength(8);
    expect(container.querySelector('.clock-face-badge')).toBeNull();
  });

  it('marks up to a wedge or empties the last one, by click or key', () => {
    const onMark = vi.fn();
    renderWithProviders(<ClockFace clock={clock()} kinds={kinds} onMark={onMark} size="lg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Segna fino a 3' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Segna 1' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Svuota 1' })[1], { key: ' ' });
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Svuota 1' })[1], { key: 'a' });
    expect(onMark.mock.calls).toEqual([[3], [1], [-1]]);
  });

  it('names a wedge by its stage, with a tooltip', () => {
    renderWithProviders(
      <ClockFace clock={clock({ segments: 4, filled: 1, stage_labels: ['Uno', 'Due'] })} kinds={kinds} onMark={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Segna 1 · Due' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Svuota 1 · Uno' })).toBeInTheDocument();
  });

  it('glows the last wedge filled', () => {
    const { container } = renderWithProviders(<ClockFace clock={clock()} kinds={kinds} glowing size="sm" />);
    expect(container.querySelectorAll('.clock-wedge-glow')).toHaveLength(1);
  });

  it.each([
    [{ state: 'closed' as const }],
    [{ state: 'lapsed' as const }],
    [{ locked: true }],
  ])('badges a closed, lapsed or waiting clock', (overrides) => {
    const { container } = renderWithProviders(<ClockFace clock={clock(overrides)} kinds={kinds} />);
    expect(container.querySelector('.clock-face-badge svg')).not.toBeNull();
  });
});
