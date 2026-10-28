import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleStepper, StartSessionZero } from '../../../components/sessionZero/ModuleChain';
import { boardWrites } from '../../../lib/sessionZero';
import { rawPostIt, rawPostItColumn } from '../../fixtures';
import { renderBoard } from './harness';

/** A chain of three steps, the table on the first: Retro, Stars and Wishes, Lines & Veils. */
const chain = [
  { id: 'm-retro', kind: 'retro', position: 0, columns: [rawPostItColumn({ cards: [rawPostIt()] })] },
  {
    id: 'm-sw',
    kind: 'stars_wishes',
    position: 1,
    columns: [
      rawPostItColumn({ id: 'sw-stars', kind: 'stars', title: '', color: 'gold' }),
      rawPostItColumn({ id: 'sw-wishes', kind: 'wishes', title: '', color: 'blue', position: 1 }),
    ],
  },
  { id: 'm-lv', kind: 'lines_veils', position: 2, columns: [] },
];
const master = { can_manage: true, modules: chain, current_module_id: 'm-retro' };

describe('ModuleStepper', () => {
  // Spec 47 Decision 4: the chain, the current step marked; a click opens a step here only.
  it('shows the chain and opens a step on this screen', async () => {
    const onView = vi.fn();
    const { act, user } = renderBoard(<ModuleStepper onView={onView} />, { board: master });
    const nav = screen.getByRole('navigation', { name: 'Tappe' });
    const steps = within(nav).getAllByRole('button', { pressed: undefined }).slice(0, 3);
    expect(steps.map((step) => step.textContent)).toEqual(['1. Retro', '2. Stelle e Desideri', '3. Linee e Veli']);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(steps[1]);
    expect(onView).toHaveBeenLastCalledWith('m-sw');
    await user.click(steps[0]);
    expect(onView).toHaveBeenLastCalledWith(null);
    expect(act).not.toHaveBeenCalled();
  });

  it('lets the Master move the table on with "Next"', async () => {
    const { act, user } = renderBoard(<ModuleStepper onView={vi.fn()} />, { board: master });
    await user.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(act).toHaveBeenCalledWith(boardWrites.setCurrentModule('m-sw'));
  });

  it('offers no "Next" on the last step', () => {
    renderBoard(<ModuleStepper onView={vi.fn()} />, { board: { ...master, current_module_id: 'm-lv' } });
    expect(screen.queryByRole('button', { name: 'Avanti' })).not.toBeInTheDocument();
  });

  it('brings the table to the step the Master has open', async () => {
    const { act, user } = renderBoard(<ModuleStepper onView={vi.fn()} />, { board: master, shownId: 'm-lv' });
    expect(screen.queryByRole('button', { name: 'Avanti' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Porta qui il tavolo' }));
    expect(act).toHaveBeenCalledWith(boardWrites.setCurrentModule('m-lv'));
  });

  // Decision 5: a Player sees the steps reached and how many are still hidden.
  it('shows a Player the steps reached and a locked count, with no controls', () => {
    renderBoard(<ModuleStepper onView={vi.fn()} />, {
      board: { modules: chain.slice(0, 1), current_module_id: 'm-retro', hidden_modules: 2 },
    });
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Avanti' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica tappe' })).not.toBeInTheDocument();
  });

  it('gives no controls in a closed session or while previewing', () => {
    const closed = [{ id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' }];
    renderBoard(<ModuleStepper onView={vi.fn()} />, { board: { ...master, rounds: closed } });
    expect(screen.queryByRole('button', { name: 'Modifica tappe' })).not.toBeInTheDocument();
  });

  it('shows no "Next" when no step is current', () => {
    renderBoard(<ModuleStepper onView={vi.fn()} />, { board: { ...master, current_module_id: null } });
    expect(screen.queryByRole('button', { name: 'Avanti' })).not.toBeInTheDocument();
  });
});

describe('StartSessionZero', () => {
  it('starts at once for a Player, and the Master can close the dialog', async () => {
    const onStart = vi.fn();
    const { user } = renderBoard(<StartSessionZero canManage={false} busy={false} onStart={onStart} />);
    await user.click(screen.getByRole('button', { name: 'Avvia la Sessione 0' }));
    expect(onStart).toHaveBeenCalledWith();
    document.body.innerHTML = '';

    const master = renderBoard(<StartSessionZero canManage busy={false} onStart={onStart} />);
    await master.user.click(screen.getByRole('button', { name: 'Avvia la Sessione 0' }));
    await screen.findByRole('dialog');
    await master.user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Edit steps', () => {
  async function openEditor(board: Record<string, unknown> = master) {
    const rendered = renderBoard(<ModuleStepper onView={vi.fn()} />, { board });
    await rendered.user.click(screen.getByRole('button', { name: 'Modifica tappe' }));
    return { ...rendered, dialog: await screen.findByRole('dialog', { name: 'Modifica tappe' }) };
  }

  // Decision 3: each change goes at once.
  it('reorders, adds and removes an empty step at once', async () => {
    const { act, user, dialog } = await openEditor();
    const ups = within(dialog).getAllByRole('button', { name: 'Sposta su' });
    const downs = within(dialog).getAllByRole('button', { name: 'Sposta giù' });
    expect(ups[0]).toBeDisabled();
    expect(downs[2]).toBeDisabled();
    await user.click(ups[1]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.reorderModules(['m-sw', 'm-retro', 'm-lv']));
    await user.click(downs[0]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.reorderModules(['m-sw', 'm-retro', 'm-lv']));

    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[2]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.removeModule('m-lv'), expect.any(Function));

    await user.click(within(dialog).getByRole('combobox', { name: 'Tappa' }));
    await user.click(await screen.findByRole('option', { name: 'Stelle e Desideri' }));
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi tappa' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.addModule('stars_wishes'));

    await user.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before removing a step that holds post-its', async () => {
    const { act, user, dialog } = await openEditor();
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[0]);
    expect(act).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('I post-it di «Retro» vengono eliminati con lei.');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(within(dialog).getAllByRole('button', { name: 'Rimuovi' })).toHaveLength(3);

    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Rimuovi' }));
    expect(act).toHaveBeenCalledWith(boardWrites.removeModule('m-retro'), expect.any(Function));
    expect(within(dialog).getAllByRole('button', { name: 'Rimuovi' })).toHaveLength(3);
  });

  // Spec 47_2: a Questions step's questions and answers go with it.
  it('asks before removing a Questions step with questions, not an empty one', async () => {
    const step = (id: string, count: number) => ({
      id,
      kind: 'questions',
      position: 0,
      columns: [],
      questions: {
        tag_id: null,
        answers_revealed: false,
        players_bypass_creation_rule: true,
        questions: Array.from({ length: count }, (_, i) => ({
          id: `${id}-${i}`,
          position: i,
          body: 'Nome?',
          hint: null,
          target: 'name',
          tag_id: null,
        })),
        answers: [],
        documents: [],
        can_create: false,
        creatable: 0,
      },
    });
    const { act, user, dialog } = await openEditor({ ...master, modules: [step('m-q', 1), step('m-empty', 0)], current_module_id: 'm-q' });
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[1]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.removeModule('m-empty'), expect.any(Function));
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[0]);
    expect(dialog).toHaveTextContent('Le domande e le risposte di «Domande» vengono eliminate con lei.');
  });

  it('keeps the last step and stops at ten', async () => {
    const one = await openEditor({ ...master, modules: chain.slice(2), current_module_id: 'm-lv' });
    expect(within(one.dialog).getByRole('button', { name: 'Rimuovi' })).toBeDisabled();
    one.dialog.ownerDocument.body.innerHTML = '';

    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, kind: 'lines_veils', position: i, columns: [] }));
    const { dialog } = await openEditor({ ...master, modules: ten, current_module_id: 'm0' });
    expect(within(dialog).getByRole('button', { name: 'Aggiungi tappa' })).toBeDisabled();
    expect(dialog).toHaveTextContent('Al massimo 10 tappe.');
  });
});
