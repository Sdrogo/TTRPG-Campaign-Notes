import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoundsBar } from '../../../components/sessionZero/RoundsBar';
import { boardWrites } from '../../../lib/sessionZero';
import { renderBoard } from './harness';

const rounds = [
  { id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' },
  { id: 'round-2', number: 2, title: 'Fine arco 1', started_at: '2026-10-20T09:00:00Z', closed_at: null },
];

describe('RoundsBar', () => {
  it('names the only round, with nothing to pick or start for a Player', () => {
    renderBoard(<RoundsBar onPick={vi.fn()} />);
    expect(screen.getByText('Sessione 0')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Decision 16: a new round, with an optional title, after asking.
  it('lets the Master start a Session 0.5', async () => {
    const { act, user } = renderBoard(<RoundsBar onPick={vi.fn()} />, { board: { can_manage: true } });
    await user.click(screen.getByRole('button', { name: 'Avvia Sessione 0.5' }));
    expect(await screen.findByRole('dialog', { name: 'Avvia Sessione 0.5' })).toHaveTextContent(
      'le bozze mai pubblicate vengono eliminate',
    );
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Avvia Sessione 0.5' }));
    await user.type(await screen.findByRole('textbox', { name: 'Titolo (facoltativo)' }), 'Fine arco 1');
    await user.click(screen.getByRole('button', { name: 'Avvia' }));
    expect(act).toHaveBeenCalledWith(boardWrites.startRound('Fine arco 1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('picks a closed round by its id', async () => {
    const onPick = vi.fn();
    const { user } = renderBoard(<RoundsBar onPick={onPick} />, {
      board: { can_manage: true, rounds, round_id: 'round-2' },
    });
    const select = screen.getByRole('combobox', { name: 'Sessione da mostrare' });
    expect(select).toHaveValue('Sessione 0.5 #1 · Fine arco 1');

    await user.click(select);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Sessione 0.5 #1 · Fine arco 1', 'Sessione 0']);
    await user.click(options[1]);
    expect(onPick).toHaveBeenCalledWith('round-1');
  });

  it('goes back to the open round as null', async () => {
    const onPick = vi.fn();
    const { user } = renderBoard(<RoundsBar onPick={onPick} />, { board: { rounds, round_id: 'round-1' } });
    await user.click(screen.getByRole('combobox', { name: 'Sessione da mostrare' }));
    await user.click(await screen.findByRole('option', { name: 'Sessione 0.5 #1 · Fine arco 1' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('marks a closed round read-only, with no new round to start from it', () => {
    renderBoard(<RoundsBar onPick={vi.fn()} />, { board: { can_manage: true, rounds, round_id: 'round-1' } });
    expect(screen.getByText('Questa sessione è chiusa: la lavagna è in sola lettura.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Avvia Sessione 0.5' })).not.toBeInTheDocument();
  });
});
