import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewSession, SessionPicker } from '../../../components/sessionZero/SessionPicker';
import { boardWrites } from '../../../lib/sessionZero';
import { renderBoard } from './harness';

const rounds = [
  { id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' },
  { id: 'round-2', number: 2, title: 'Fine arco 1', started_at: '2026-10-20T09:00:00Z', closed_at: null },
];

describe('SessionPicker', () => {
  // Spec 46d Decision 4: the selector names the page, even with one session.
  it('names the only session', () => {
    renderBoard(<SessionPicker onPick={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Sessione da mostrare' })).toHaveValue('Sessione 0');
    expect(screen.queryByText('Chiusa')).not.toBeInTheDocument();
  });

  // Spec 46d Decision 3: a named session shows its name alone.
  it('picks a closed session by its id, listing sessions by name', async () => {
    const onPick = vi.fn();
    const { user } = renderBoard(<SessionPicker onPick={onPick} />, { board: { rounds, round_id: 'round-2' } });
    const select = screen.getByRole('combobox', { name: 'Sessione da mostrare' });
    expect(select).toHaveValue('Fine arco 1');

    await user.click(select);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Fine arco 1', 'Sessione 0']);
    await user.click(options[1]);
    expect(onPick).toHaveBeenCalledWith('round-1');
  });

  it('goes back to the open session as null', async () => {
    const onPick = vi.fn();
    const { user } = renderBoard(<SessionPicker onPick={onPick} />, { board: { rounds, round_id: 'round-1' } });
    await user.click(screen.getByRole('combobox', { name: 'Sessione da mostrare' }));
    await user.click(await screen.findByRole('option', { name: 'Fine arco 1' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('marks a closed session with a badge explaining it is read-only', async () => {
    const { user } = renderBoard(<SessionPicker onPick={vi.fn()} />, { board: { rounds, round_id: 'round-1' } });
    await user.hover(screen.getByText('Chiusa'));
    expect(await screen.findByText('Questa sessione è chiusa: la lavagna è in sola lettura.')).toBeInTheDocument();
  });
});

describe('NewSession', () => {
  // Spec 46d Decision 3: the name is free, prefilled with the next default.
  it('starts a session with the name typed, after asking', async () => {
    const { act, user } = renderBoard(<NewSession />, { board: { can_manage: true, rounds } });
    await user.click(screen.getByRole('button', { name: 'Nuova sessione' }));
    expect(await screen.findByRole('dialog', { name: 'Nuova sessione' })).toHaveTextContent(
      'le bozze mai pubblicate vengono eliminate',
    );
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Nuova sessione' }));
    const name = await screen.findByRole('textbox', { name: 'Nome' });
    expect(name).toHaveValue('Sessione 2');
    await user.clear(name);
    await user.type(name, 'Retro di metà campagna');
    await user.click(screen.getByRole('button', { name: 'Crea' }));
    expect(act).toHaveBeenCalledWith(
      boardWrites.startRound('Retro di metà campagna', [
        { kind: 'retro', carry: false },
        { kind: 'lines_veils', carry: false },
      ]),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stores no name when the default is kept, so it shows in each language', async () => {
    const { act, user } = renderBoard(<NewSession />, { board: { can_manage: true } });
    await user.click(screen.getByRole('button', { name: 'Nuova sessione' }));
    expect(await screen.findByRole('textbox', { name: 'Nome' })).toHaveValue('Sessione 1');
    await user.click(screen.getByRole('button', { name: 'Crea' }));
    expect(act).toHaveBeenCalledWith(
      boardWrites.startRound('', [
        { kind: 'retro', carry: false },
        { kind: 'lines_veils', carry: false },
      ]),
    );
  });

  // Spec 47b: each step starts empty unless it carries the previous session's content over.
  it('carries a step over only when ticked', async () => {
    const { act, user } = renderBoard(<NewSession />, { board: { can_manage: true } });
    await user.click(screen.getByRole('button', { name: 'Nuova sessione' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuova sessione' });
    const boxes = within(dialog).getAllByRole('checkbox', { name: 'Porta dalla sessione precedente' });
    expect(boxes).toHaveLength(1);
    await user.click(boxes[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Crea' }));
    expect(act).toHaveBeenCalledWith(
      boardWrites.startRound('', [
        { kind: 'retro', carry: true },
        { kind: 'lines_veils', carry: false },
      ]),
    );
  });
});
