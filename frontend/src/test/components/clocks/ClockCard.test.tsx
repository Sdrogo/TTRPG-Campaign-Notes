import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toClock, toRules } from '../../../lib/clocks';
import { rawClock, rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockCard, MarkKindLegend, type ClockCardActions } from '../../../components/clocks/ClockCard';

const rules = toRules(rawRules());
const clock = (overrides: Parameters<typeof rawClock>[0] = {}) => toClock(rawClock(overrides));

function render(overrides: Parameters<typeof rawClock>[0] = {}, actions: Partial<ClockCardActions> = {}, isMaster = true) {
  const all: ClockCardActions = {
    onMark: vi.fn(),
    onMarkMany: vi.fn(),
    onHistory: vi.fn(),
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    ...actions,
  };
  const user = userEvent.setup();
  renderWithProviders(
    <ClockCard
      roomId="room-1"
      clock={clock(overrides)}
      kinds={rules.markKinds}
      labels={rules.labels}
      isMaster={isMaster}
      actions={all}
    />,
  );
  return { user, actions: all };
}

describe('ClockCard', () => {
  it('shows the name, the progress, its labels, condition and document', () => {
    render({
      label_ids: ['label-1', 'gone'],
      closing_condition: 'Arrivano le guardie',
      decisive_label: 'Jazz',
      document: { id: 'doc-1', name: 'Villa' },
    });
    expect(screen.getByText('Allarme')).toBeInTheDocument();
    expect(screen.getByText('4/8')).toBeInTheDocument();
    expect(screen.getAllByText('Jazz')).toHaveLength(2);
    expect(screen.getByText('Arrivano le guardie')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '→ Villa' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-1');
    expect(screen.queryByText('Aperto')).not.toBeInTheDocument();
  });

  it('marks with −, + and a kind from ▾', async () => {
    const { user, actions } = render();
    const card = clock();
    await user.click(screen.getByRole('button', { name: 'Svuota un segmento di «Allarme»' }));
    await user.click(screen.getByRole('button', { name: 'Segna un segmento di «Allarme»' }));
    await user.click(screen.getByRole('button', { name: 'Segna «Allarme» con un tipo di segno' }));
    await user.click(screen.getByRole('menuitem', { name: 'Shock' }));
    await user.click(screen.getByRole('button', { name: 'Segna fino a 2' }));
    expect(actions.onMark).toHaveBeenNthCalledWith(1, card, -1);
    expect(actions.onMark).toHaveBeenNthCalledWith(2, card, 1);
    expect(actions.onMark).toHaveBeenNthCalledWith(3, card, 1, 'kind-2');
    expect(actions.onMark).toHaveBeenNthCalledWith(4, card, 2);
  });

  it('runs each menu item', async () => {
    const { user, actions } = render();
    const menu = () => user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    for (const name of ['Segna…', 'Cronologia', 'Modifica', 'Archivia', 'Elimina']) {
      await menu();
      await user.click(await screen.findByRole('menuitem', { name }));
    }
    expect(actions.onMarkMany).toHaveBeenCalled();
    expect(actions.onHistory).toHaveBeenCalled();
    expect(actions.onEdit).toHaveBeenCalled();
    expect(actions.onArchive).toHaveBeenCalledWith(clock(), true);
    expect(actions.onDelete).toHaveBeenCalled();
  });

  it('restores an archived clock and shows its state, without marks', async () => {
    const { user, actions } = render({ archived: true });
    expect(screen.getByText('Archiviato')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Segna un segmento/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    expect(screen.queryByRole('menuitem', { name: 'Segna…' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Ripristina' }));
    expect(actions.onArchive).toHaveBeenCalledWith(clock({ archived: true }), false);
  });

  it('greens a closed clock, which can still be emptied', () => {
    render({ state: 'closed', filled: 8 });
    expect(screen.getByText('Chiuso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Svuota un segmento di «Allarme»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /con un tipo di segno/ })).not.toBeInTheDocument();
  });

  it("hides a member's missing rights and actions", async () => {
    const { user } = render(
      { can_manage: false, can_unmark: false, state: 'proposed' },
      { onMarkMany: undefined, onHistory: undefined },
      false,
    );
    expect(screen.queryByRole('button', { name: /Svuota/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('offers no ▾ when no kind is usable, and no archive for a proposal', async () => {
    const { user } = render({ state: 'proposed', can_mark: false }, {}, false);
    expect(screen.queryByRole('button', { name: /con un tipo di segno/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    expect(screen.queryByRole('menuitem', { name: 'Archivia' })).not.toBeInTheDocument();
  });

  it('shows small and large sizes', () => {
    renderWithProviders(
      <>
        <ClockCard roomId="r" clock={clock()} kinds={[]} labels={[]} isMaster size="sm" actions={{ onMark: vi.fn() }} />
        <ClockCard roomId="r" clock={clock({ id: 'b' })} kinds={[]} labels={[]} isMaster size="lg" actions={{ onMark: vi.fn() }} />
      </>,
    );
    expect(screen.getAllByText('Allarme')).toHaveLength(2);
  });
});

describe('MarkKindLegend', () => {
  it('lists each kind and who may use it, or nothing', () => {
    const { rerender } = renderWithProviders(<MarkKindLegend kinds={rules.markKinds} />);
    expect(screen.getByRole('list', { name: 'Tipi di segno' })).toHaveTextContent('Successo (Giocatori)Shock (Master)');
    rerender(<MarkKindLegend kinds={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
