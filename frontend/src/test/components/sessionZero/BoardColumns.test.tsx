import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AddColumn, LinesVeilsColumn, RetroColumn } from '../../../components/sessionZero/BoardColumns';
import { boardWrites, toSessionZero, type RawSessionZero } from '../../../lib/sessionZero';
import { rawSessionZero } from '../../fixtures';
import { renderBoard } from './harness';

const board = toSessionZero(rawSessionZero() as RawSessionZero);
const [first, second] = board.retro;
const [must, lines] = board.linesVeils;
const master = { board: { can_manage: true } };
const DRAG_TYPE = 'application/x-exlibris-post-it';

function drag(payload: object, types = [DRAG_TYPE]) {
  return { types, getData: (type: string) => (type === DRAG_TYPE ? JSON.stringify(payload) : '') };
}

/** Drops onto `target`, returning whether the page took the drop (prevented the default). */
function drop(target: HTMLElement, dataTransfer: object) {
  const over = createEvent.dragOver(target, { dataTransfer });
  fireEvent(target, over);
  const event = createEvent.drop(target, { dataTransfer });
  fireEvent(target, event);
  return over.defaultPrevented && event.defaultPrevented;
}

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

  it('is no drop target', () => {
    const { act } = renderBoard(<RetroColumn column={first} index={0} count={2} open />, master);
    const frame = screen.getByRole('heading', { name: 'Lo vogliamo al tavolo' }).closest('.mantine-Paper-root')!;
    expect(drop(frame as HTMLElement, drag({ id: 'x', action: 'promote', columnId: 'col-2' }))).toBe(false);
    expect(act).not.toHaveBeenCalled();
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

  // Decisions 2, 8 and 16: the Master drops a Retro post-it to promote it, a Lines & Veils one to move it.
  it('promotes or moves the post-it the Master drops on it', () => {
    const { act } = renderBoard(<LinesVeilsColumn column={lines} />, master);
    const frame = frameOf('Linee');

    fireEvent.dragOver(frame, { dataTransfer: drag({}) });
    expect(frame).toHaveAttribute('data-drop-over', 'true');
    fireEvent.dragLeave(frame);
    expect(frame).not.toHaveAttribute('data-drop-over');

    expect(drop(frame, drag({ id: 'card-1', action: 'promote', columnId: 'col-1' }))).toBe(true);
    expect(act).toHaveBeenLastCalledWith(boardWrites.promote('card-1', 'lv-lines'));
    expect(frame).not.toHaveAttribute('data-drop-over');
    drop(frame, drag({ id: 'card-2', action: 'move', columnId: 'lv-must' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.move('card-2', 'lv-lines'));
    drop(frame, drag({ id: 'card-3', action: 'move', columnId: 'lv-lines' }));
    expect(act).toHaveBeenCalledTimes(2);
  });

  it('ignores anything else dropped on it, and every drop for a Player', () => {
    const { act } = renderBoard(<LinesVeilsColumn column={lines} />, master);
    expect(drop(frameOf('Linee'), drag({}, ['text/plain']))).toBe(false);
    expect(act).not.toHaveBeenCalled();
  });

  it('is no drop target for a Player', () => {
    const { act } = renderBoard(<LinesVeilsColumn column={lines} />);
    expect(drop(frameOf('Linee'), drag({ id: 'card-1', action: 'promote', columnId: 'col-1' }))).toBe(false);
    expect(act).not.toHaveBeenCalled();
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
    expect(act).toHaveBeenCalledWith(boardWrites.addColumn('Toni'));

    await user.click(screen.getByRole('button', { name: 'Aggiungi colonna' }));
    expect(screen.getByRole('textbox', { name: 'Titolo della colonna' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Titolo della colonna' }), 'Ritmo{Enter}');
    expect(act).toHaveBeenLastCalledWith(boardWrites.addColumn('Ritmo'));
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
