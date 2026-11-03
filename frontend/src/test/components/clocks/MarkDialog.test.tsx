import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toClock, toRules } from '../../../lib/clocks';
import { rawClock, rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { MarkDialog } from '../../../components/clocks/MarkDialog';

const kinds = toRules(rawRules()).markKinds;

describe('MarkDialog', () => {
  it('marks several segments with a kind and a note', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <MarkDialog clock={toClock(rawClock())} kinds={kinds} isMaster={false} onSubmit={onSubmit} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Ne restano 4 liberi.')).toBeInTheDocument();
    const count = screen.getByRole('textbox', { name: 'Segmenti' });
    await user.clear(count);
    await user.type(count, '3');
    await user.type(screen.getByRole('textbox', { name: 'Nota' }), 'porta');
    expect(screen.getByRole('combobox', { name: 'Tipo di segno' })).toHaveValue('Successo');
    await user.click(screen.getByRole('button', { name: 'Segna 3' }));
    expect(onSubmit).toHaveBeenCalledWith({ delta: 3, kindId: 'kind-1', note: 'porta' });
  });

  it('has no kind when none is usable, cannot mark a full clock, and cancels', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <MarkDialog clock={toClock(rawClock({ filled: 8 }))} kinds={[]} isMaster onSubmit={vi.fn()} onClose={onClose} />,
    );
    expect(screen.queryByRole('combobox', { name: 'Tipo di segno' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Segna 1' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Segmenti' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalled();
  });
});
