import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toClock, toGroup, type GroupPrompt } from '../../../lib/clocks';
import { rawClock, rawGroup } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockGroupBand, type GroupBandActions } from '../../../components/clocks/ClockGroupBand';

const fuga = toClock(rawClock({ id: 'a', name: 'Fuga', state: 'closed' }));
const accerchiati = toClock(rawClock({ id: 'b', name: 'Accerchiati', state: 'closed', decisive_label: 'Presi' }));

function render(
  overrides: Parameters<typeof rawGroup>[0] = {},
  prompt: GroupPrompt | null = null,
  withActions = true,
  archived = false,
) {
  const actions: GroupBandActions = {
    onEdit: vi.fn(),
    onNewTurn: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onEnd: vi.fn(),
    onReveal: vi.fn(),
    onDismiss: vi.fn(),
    pending: false,
  };
  const group = toGroup(rawGroup(overrides));
  renderWithProviders(
    <ClockGroupBand group={group} clocks={[fuga, accerchiati]} archived={archived} prompt={prompt} actions={withActions ? actions : undefined}>
      <span>faces</span>
    </ClockGroupBand>,
  );
  return { user: userEvent.setup(), actions, group };
}

describe('ClockGroupBand', () => {
  it('shows a Player the name, mode and result, without controls', () => {
    render({ ended: true, result: { winner_ids: ['a'], tie: false } }, { kind: 'race', clocks: [fuga] }, false);
    expect(screen.getByRole('region', { name: 'Fuga' })).toHaveTextContent('Gara');
    expect(screen.getByText('Terminato')).toBeInTheDocument();
    expect(screen.getByText('Vinto: «Fuga»')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("runs the Master's menu", async () => {
    const { user, actions, group } = render();
    const open = () => user.click(screen.getByRole('button', { name: 'Azioni del gruppo «Fuga»' }));
    for (const name of ['Modifica', 'Archivia il gruppo', 'Elimina il gruppo']) {
      await open();
      await user.click(await screen.findByRole('menuitem', { name }));
    }
    expect(actions.onEdit).toHaveBeenCalledWith(group);
    expect(actions.onArchive).toHaveBeenCalledWith(group, true);
    expect(actions.onDelete).toHaveBeenCalledWith(group);
    await open();
    expect(screen.queryByRole('menuitem', { name: 'Nuova svolta' })).not.toBeInTheDocument();
  });

  it('offers a new turn on an ended turn, and restores an archived group', async () => {
    const { user, actions, group } = render(
      { mode: 'turn', ended: true, result: { outcomes: [{ clock_id: 'b', label: 'Presi' }] } },
      null,
      true,
      true,
    );
    expect(screen.getByText('Svolta: Presi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Azioni del gruppo «Fuga»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Nuova svolta' }));
    expect(actions.onNewTurn).toHaveBeenCalledWith(group);
    await user.click(screen.getByRole('button', { name: 'Azioni del gruppo «Fuga»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ripristina il gruppo' }));
    expect(actions.onArchive).toHaveBeenCalledWith(group, false);
  });

  it('asks to confirm a race won, or a tie', async () => {
    const { user, actions, group } = render({}, { kind: 'race', clocks: [fuga] });
    expect(screen.getByRole('status')).toHaveTextContent('«Fuga» si è chiuso per primo.');
    await user.click(screen.getByRole('button', { name: 'Conferma' }));
    await user.click(screen.getByRole('button', { name: 'Non ancora' }));
    expect(actions.onEnd).toHaveBeenCalledWith(group);
    expect(actions.onDismiss).toHaveBeenCalledWith(group);
  });

  it('says a tie', () => {
    render({}, { kind: 'race', clocks: [fuga, accerchiati] });
    expect(screen.getByRole('status')).toHaveTextContent('«Fuga», «Accerchiati» si sono chiusi: è un pari');
  });

  it('asks to end a turn', async () => {
    const { user, actions } = render({ mode: 'turn' }, { kind: 'turn', clocks: [accerchiati] });
    expect(screen.getByRole('status')).toHaveTextContent('La svolta termina: «Accerchiati» (Presi).');
    await user.click(screen.getByRole('button', { name: 'Termina la svolta' }));
    expect(actions.onEnd).toHaveBeenCalled();
  });

  it("asks to reveal a sequence's next clock", async () => {
    const { user, actions } = render({ mode: 'sequence' }, { kind: 'reveal', clock: fuga });
    expect(screen.getByRole('status')).toHaveTextContent('«Fuga» è il prossimo, ma i giocatori non lo vedono.');
    await user.click(screen.getByRole('button', { name: 'Rivela alla Stanza' }));
    await user.click(screen.getByRole('button', { name: 'Non ora' }));
    expect(actions.onReveal).toHaveBeenCalledWith(fuga);
    expect(actions.onDismiss).toHaveBeenCalled();
  });
});
