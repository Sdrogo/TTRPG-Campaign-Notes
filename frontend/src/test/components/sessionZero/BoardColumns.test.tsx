import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AddColumn, LinesVeilsColumn, RetroBoard, RetroColumn } from '../../../components/sessionZero/BoardColumns';
import { boardWrites, toSessionZero, type RawSessionZero } from '../../../lib/sessionZero';
import { rawPostIt, rawSessionZero } from '../../fixtures';
import { column, renderBoard } from './harness';

const board = toSessionZero(rawSessionZero() as RawSessionZero);
const [first, second] = board.retro;
const [must, , lines] = board.linesVeils;
const master = { board: { can_manage: true } };
const lineCount = (container: HTMLElement | Document = document) => container.querySelectorAll('.sz-drop-line').length;

describe('RetroColumn', () => {
  it('lets every member add a post-it as a draft', async () => {
    const { act, user } = renderBoard(<RetroColumn column={first} index={0} count={2} open />);
    expect(screen.getByRole('article')).toHaveTextContent('Niente ragni');
    expect(screen.queryByRole('button', { name: /Azioni della colonna/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi post-it' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi post-it' }));
    await user.type(screen.getByRole('textbox', { name: 'Testo del post-it' }), 'Horror leggero');
    await user.click(screen.getByRole('button', { name: 'Salva bozza' }));
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(boardWrites.addPostIt('col-1', 'Horror leggero'));
    expect(screen.getByRole('button', { name: 'Aggiungi post-it' })).toBeInTheDocument();
  });

  it('takes no new post-its on a closed round or in "View as"', () => {
    renderBoard(
      <>
        <RetroColumn column={first} index={0} count={2} open={false} />
        <RetroColumn column={second} index={1} count={2} open />
      </>,
      { writable: false },
    );
    expect(screen.queryByRole('button', { name: 'Aggiungi post-it' })).not.toBeInTheDocument();
  });

  it('lets the Master rename the column', async () => {
    const { act, user } = renderBoard(<RetroColumn column={first} index={0} count={2} open />, master);
    const rename = async () => {
      await user.click(screen.getByRole('button', { name: 'Azioni della colonna Lo vogliamo al tavolo' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Rinomina' }));
      return screen.getByRole('textbox', { name: 'Titolo della colonna' });
    };

    await user.type(await rename(), '{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const input = await rename();
    await user.clear(input);
    await user.type(input, '{Enter}');
    expect(act).not.toHaveBeenCalled();
    await user.type(input, ' Sì al tavolo {Enter}');
    expect(act).toHaveBeenCalledWith(boardWrites.renameColumn('col-1', 'Sì al tavolo'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.blur(await rename());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('lets the Master move the column, only where there is room', async () => {
    const { act, user } = renderBoard(
      <>
        <RetroColumn column={first} index={0} count={2} open />
        <RetroColumn column={second} index={1} count={2} open />
      </>,
      master,
    );
    await user.click(screen.getByRole('button', { name: 'Azioni della colonna Lo vogliamo al tavolo' }));
    expect(screen.queryByRole('menuitem', { name: 'Sposta a sinistra' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Sposta a destra' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.reorderColumns(['col-2', 'col-1']));

    await user.click(screen.getByRole('button', { name: 'Azioni della colonna Da evitare' }));
    expect(screen.queryByRole('menuitem', { name: 'Sposta a destra' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Sposta a sinistra' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.reorderColumns(['col-2', 'col-1']));
  });

  it('asks the Master before deleting the column and its post-its', async () => {
    const { act, user } = renderBoard(<RetroColumn column={first} index={0} count={2} open />, master);
    const remove = async () => {
      await user.click(screen.getByRole('button', { name: 'Azioni della colonna Lo vogliamo al tavolo' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Elimina' }));
      return screen.findByRole('dialog', { name: 'Eliminare la colonna?' });
    };

    expect(await remove()).toHaveTextContent('La colonna «Lo vogliamo al tavolo» verrà eliminata');
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();
    await remove();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(act).not.toHaveBeenCalled();

    const dialog = await remove();
    await user.click(within(dialog).getByRole('button', { name: 'Elimina' }));
    expect(act).toHaveBeenCalledWith(boardWrites.deleteColumn('col-1'));
  });

  // Spec 46c Decision 5: a band and a tint in the column's colour, which the Master changes.
  it('wears its colour, which the Master changes from its menu', async () => {
    const { act, user } = renderBoard(<RetroColumn column={first} index={0} count={2} open />, master);
    const frame = screen.getByRole('heading', { name: 'Lo vogliamo al tavolo' }).closest('.sz-column') as HTMLElement;
    expect(frame.style.getPropertyValue('--sz-color')).toBe('var(--mantine-color-green-5)');

    await user.click(screen.getByRole('button', { name: 'Azioni della colonna Lo vogliamo al tavolo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Colore' }));
    const dialog = await screen.findByRole('dialog', { name: 'Colore' });
    expect(within(dialog).getByRole('radio', { name: 'Verde' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(act).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Azioni della colonna Lo vogliamo al tavolo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Colore' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: 'Fucsia' }));
    expect(act).toHaveBeenCalledWith(boardWrites.recolorColumn('col-1', 'purple'), expect.any(Function));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // Spec 46c Decision 9 and 46d Decision 7: groups and lone post-its in their order, a group's post-its framed together.
  it('frames grouped post-its together, in the column order', () => {
    const grouped = column({
      groups: [{ id: 'g-1', title: 'Draghi', position: 1 }],
      cards: [
        rawPostIt({ id: 'c', body: 'Ancora solo', position: 2 }),
        rawPostIt({ id: 'd', body: 'Draghi blu', group_id: 'g-1', position: 1 }),
        rawPostIt({ id: 'a', body: 'Solo', position: 0 }),
        rawPostIt({ id: 'b', body: 'Draghi rossi', group_id: 'g-1', position: 0 }),
      ],
    });
    renderBoard(<RetroColumn column={grouped} index={0} count={1} open />);
    const group = screen.getByRole('group', { name: 'Draghi' });
    expect(within(group).getAllByRole('article').map((a) => a.textContent)).toEqual([
      expect.stringContaining('Draghi rossi'),
      expect.stringContaining('Draghi blu'),
    ]);
    expect(group).toHaveTextContent('2 post-it');
    expect(screen.getAllByRole('article').map((a) => a.textContent?.split('Tu')[0])).toEqual([
      'Solo',
      'Draghi rossi',
      'Draghi blu',
      'Ancora solo',
    ]);
  });

  // Spec 46d Decision 7: a dragged post-it or group shows a line where it lands.
  it('shows a line where the dragged post-it lands', () => {
    const two = column({ cards: [rawPostIt({ id: 'a', body: 'Primo' }), rawPostIt({ id: 'b', body: 'Secondo', position: 1 })] });
    const dragging = (beforeId: string | null) => ({
      active: { kind: 'card' as const, id: 'x' },
      intent: { kind: 'place' as const, columnId: 'col-1', groupId: null, beforeId },
    });
    renderBoard(<RetroColumn column={two} index={0} count={1} open />, { dnd: dragging('b') });
    const line = document.querySelector('.sz-drop-line')!;
    expect(line.nextElementSibling).toHaveTextContent('Secondo');
    expect(lineCount()).toBe(1);
  });

  it('shows the line at the end, and none for a drag elsewhere', () => {
    const at = (columnId: string) => ({
      active: { kind: 'card' as const, id: 'x' },
      intent: { kind: 'place' as const, columnId, groupId: null, beforeId: null },
    });
    renderBoard(
      <>
        <RetroColumn column={first} index={0} count={2} open />
        <RetroColumn column={second} index={1} count={2} open />
      </>,
      { dnd: at('col-2') },
    );
    const frame = screen.getByRole('heading', { name: 'Da evitare' }).closest('.sz-column') as HTMLElement;
    expect(lineCount(frame)).toBe(1);
    expect(lineCount()).toBe(1);
  });

  // The Master drags a column by its heading; a Player's heading is no handle.
  it("makes the Master's heading the column's drag handle", () => {
    renderBoard(
      <>
        <RetroColumn column={first} index={0} count={2} open />
        <RetroColumn column={second} index={1} count={2} open={false} />
      </>,
      master,
    );
    expect(screen.getByRole('heading', { name: 'Lo vogliamo al tavolo' })).toHaveStyle({ cursor: 'grab' });
    expect(screen.getByRole('heading', { name: 'Da evitare' })).not.toHaveStyle({ cursor: 'grab' });
  });
});

// Spec 46d Decision 7: a column the Master drags shows a line where it lands.
describe('RetroBoard', () => {
  const dragging = (beforeId: string | null) => ({
    ...master,
    dnd: { active: { kind: 'column' as const, id: 'col-1' }, intent: { kind: 'column' as const, beforeId } },
  });

  it('shows a line before the column it would go before', () => {
    renderBoard(<RetroBoard />, dragging('col-2'));
    const line = document.querySelector('.sz-drop-line-x')!;
    expect(line.nextElementSibling).toContainElement(screen.getByRole('heading', { name: 'Da evitare' }));
  });

  it('shows the line after the last column, and offers "Add column"', () => {
    renderBoard(<RetroBoard />, dragging(null));
    const line = document.querySelector('.sz-drop-line-x')!;
    expect(line.previousElementSibling).toContainElement(screen.getByRole('heading', { name: 'Da evitare' }));
    expect(screen.getByRole('button', { name: 'Aggiungi colonna' })).toBeInTheDocument();
  });
});

describe('LinesVeilsColumn', () => {
  const frameOf = (name: string) =>
    screen.getByRole('heading', { name }).closest('.mantine-Paper-root') as HTMLElement;

  it('names its kind and says when it is empty', () => {
    renderBoard(<LinesVeilsColumn column={must} />);
    expect(screen.getByRole('heading', { name: 'Must' })).toBeInTheDocument();
    expect(screen.getByText('Ancora nessun post-it.')).toBeInTheDocument();
  });

  it('shows its post-its', () => {
    const withCard = { ...lines, cards: board.retro[0].cards };
    renderBoard(<LinesVeilsColumn column={withCard} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.queryByText('Ancora nessun post-it.')).not.toBeInTheDocument();
  });

  // Decisions 2 and 8: a Retro post-it dragged over the row would be promoted there.
  it('lights up as where a dragged Retro post-it is promoted', () => {
    renderBoard(
      <>
        <LinesVeilsColumn column={lines} />
        <LinesVeilsColumn column={must} />
      </>,
      { ...master, dnd: { active: { kind: 'card', id: 'card-1' }, intent: { kind: 'promote', columnId: 'lv-lines' } } },
    );
    expect(frameOf('Linee')).toHaveAttribute('data-drop-over', 'true');
    expect(frameOf('Must')).not.toHaveAttribute('data-drop-over');
  });

  // Decision 16, spec 46d Decision 7: a Lines & Veils post-it lands where the line shows, between or after.
  it('shows a line before a post-it or after the last', () => {
    const row = {
      ...lines,
      cards: column({ cards: [rawPostIt({ id: 'a', column_id: 'lv-lines' }), rawPostIt({ id: 'b', column_id: 'lv-lines', position: 1 })] }).cards,
    };
    const at = (beforeId: string | null) => ({
      ...master,
      dnd: {
        active: { kind: 'card' as const, id: 'x' },
        intent: { kind: 'place' as const, columnId: 'lv-lines', groupId: null, beforeId },
      },
    });
    renderBoard(<LinesVeilsColumn column={row} />, at('b'));
    expect(document.querySelector('.sz-drop-line-x:not([data-end])')).toBeInTheDocument();
    expect(document.querySelector('[data-end]')).not.toBeInTheDocument();
    cleanup();
    renderBoard(<LinesVeilsColumn column={row} />, at(null));
    expect(document.querySelectorAll('.sz-drop-line-x[data-end]')).toHaveLength(1);
  });

  it('takes no new post-its from a Player, who writes nothing in it', () => {
    renderBoard(<LinesVeilsColumn column={lines} />);
    expect(screen.queryByRole('button', { name: 'Aggiungi' })).not.toBeInTheDocument();
  });

  // Spec 46c Decision 6: the Master writes a limit directly, published at once.
  it('lets the Master write in it directly', async () => {
    const { act, user } = renderBoard(<LinesVeilsColumn column={lines} />, master);
    expect(frameOf('Linee').style.getPropertyValue('--sz-color')).toBe('var(--accent-strong)');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(screen.queryByText('Ancora nessun post-it.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByText('Ancora nessun post-it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await user.type(screen.getByRole('textbox', { name: 'Testo del post-it' }), 'Niente tortura');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(act).toHaveBeenCalledWith(boardWrites.addPostIt('lv-lines', 'Niente tortura'), expect.any(Function));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('AddColumn', () => {
  it('adds a column with the title typed', async () => {
    const { act, user } = renderBoard(<AddColumn />, master);
    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Titolo della colonna' }), '{Enter}');
    expect(act).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Titolo della colonna' }), ' Toni ');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(act).toHaveBeenCalledWith(boardWrites.addColumn('Toni', 'default'));

    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    expect(screen.getByRole('textbox', { name: 'Titolo della colonna' })).toHaveValue('');
    await user.click(screen.getByRole('radio', { name: 'Fucsia' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo della colonna' }), 'Ritmo{Enter}');
    expect(act).toHaveBeenLastCalledWith(boardWrites.addColumn('Ritmo', 'purple'));

    // The colour starts over at the default.
    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    expect(screen.getByRole('radio', { name: 'Predefinito' })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes on Escape or Cancel', async () => {
    const { act, user } = renderBoard(<AddColumn />, master);
    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo della colonna' }), 'X{Escape}');
    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'Aggiungi colonna' })).toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
  });
});
