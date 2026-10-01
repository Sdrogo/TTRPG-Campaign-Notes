import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { MainTagsEditor } from '../../../components/setup/MainTagsEditor';
import type { MainItem, Tag } from '../../../types/tag';

/** A Tag; the editor works from the saved items, not from `mainPosition`. */
const tag = (id: string, name: string): Tag => ({ id, name, category: null, mainPosition: null });

const npc = tag('npc', 'NPC');
const pc = tag('pc', 'PC');
const place = tag('place', 'Luogo');

/** A saved Main item of the given Tag ids. */
const item = (...tagIds: string[]): MainItem => ({ tagIds });

/** Renders the editor and returns its save spy and a user. */
function render(tags: Tag[], items: MainItem[], saving = false) {
  const onSave = vi.fn();
  renderWithProviders(<MainTagsEditor tags={tags} items={items} saving={saving} onSave={onSave} />);
  return { onSave, user: userEvent.setup() };
}

/** The text of each Main item row, in order. */
const names = () => screen.getAllByRole('listitem').map((row) => row.textContent);

/** The save button. */
const saveButton = () => screen.getByRole('button', { name: 'Salva ordine' });

describe('MainTagsEditor', () => {
  // Spec 11: the list shows the saved order, which is the Documents page's.
  it('lists the Main items in their saved order', () => {
    render([npc, pc, place], [item('pc'), item('npc')]);

    expect(names()).toEqual(['1. #PC', '2. #NPC']);
  });

  it('says so when there are no Main items', () => {
    render([place], []);

    expect(screen.getByText(/Nessun Tag principale/)).toBeInTheDocument();
  });

  it('cannot save until something changed', () => {
    render([npc, pc], [item('npc'), item('pc')]);

    expect(saveButton()).toBeDisabled();
  });

  it('moves an item down and saves the new order', async () => {
    const { onSave, user } = render([npc, pc], [item('npc'), item('pc')]);

    await user.click(screen.getByRole('button', { name: 'Sposta NPC giù' }));
    expect(names()).toEqual(['1. #PC', '2. #NPC']);
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith([item('pc'), item('npc')]);
  });

  it('moves an item up', async () => {
    const { user } = render([npc, pc], [item('npc'), item('pc')]);

    await user.click(screen.getByRole('button', { name: 'Sposta PC su' }));

    expect(names()).toEqual(['1. #PC', '2. #NPC']);
  });

  it('cannot move the first item up or the last one down', () => {
    render([npc, pc], [item('npc'), item('pc')]);

    expect(screen.getByRole('button', { name: 'Sposta NPC su' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta PC giù' })).toBeDisabled();
  });

  it('removes an item, and offers its Tag again', async () => {
    const { onSave, user } = render([npc, pc], [item('npc'), item('pc')]);

    await user.click(screen.getByRole('button', { name: 'Rimuovi NPC dai Tag principali' }));
    expect(names()).toEqual(['1. #PC']);
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith([item('pc')]);
    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));
    expect(screen.getByRole('option', { name: 'NPC' })).toBeInTheDocument();
  });

  it('adds another Tag at the end', async () => {
    const { onSave, user } = render([npc, place], [item('npc')]);

    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));
    await user.click(screen.getByRole('option', { name: 'Luogo' }));
    expect(names()).toEqual(['1. #NPC', '2. #Luogo']);
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith([item('npc'), item('place')]);
  });

  it('does not offer a Tag that is already a single item', async () => {
    const { user } = render([npc, place], [item('npc')]);

    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));

    expect(screen.queryByRole('option', { name: 'NPC' })).not.toBeInTheDocument();
  });

  it('says so when every Tag is already a single item', () => {
    render([npc], [item('npc')]);

    expect(screen.getByText('Ogni Tag è già un Tag principale.')).toBeInTheDocument();
  });

  it('can save an emptied list, which clears the Main items', async () => {
    const { onSave, user } = render([npc], [item('npc')]);

    await user.click(screen.getByRole('button', { name: 'Rimuovi NPC dai Tag principali' }));
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith([]);
  });

  // Spec 11_2: a combination of two or more Tags is a line item of its own.
  describe('combinations', () => {
    it('shows a saved combination as its Tags joined with a plus', () => {
      render([npc, pc, place], [item('npc'), item('npc', 'place')]);

      expect(names()).toEqual(['1. #NPC', '2. #NPC + #Luogo']);
    });

    it('drops a saved item that refers to a missing Tag', () => {
      render([npc], [item('npc'), item('npc', 'gone')]);

      expect(names()).toEqual(['1. #NPC']);
    });

    it('adds a combination of the picked Tags at the end and saves it', async () => {
      const { onSave, user } = render([npc, pc, place], [item('npc')]);

      await user.click(screen.getByRole('combobox', { name: 'Aggiungi una combinazione' }));
      await user.click(screen.getByRole('option', { name: 'PC' }));
      await user.click(screen.getByRole('option', { name: 'Luogo' }));
      await user.click(screen.getByRole('button', { name: 'Aggiungi combinazione' }));
      expect(names()).toEqual(['1. #NPC', '2. #PC + #Luogo']);
      await user.click(saveButton());

      expect(onSave).toHaveBeenCalledWith([item('npc'), item('pc', 'place')]);
    });

    it('needs at least two Tags', async () => {
      const { user } = render([npc, pc], []);

      await user.click(screen.getByRole('combobox', { name: 'Aggiungi una combinazione' }));
      await user.click(screen.getByRole('option', { name: 'PC' }));

      expect(screen.getByRole('button', { name: 'Aggiungi combinazione' })).toBeDisabled();
    });

    it('refuses a combination that is already listed, in any order', async () => {
      const { user } = render([npc, pc], [item('npc', 'pc')]);

      await user.click(screen.getByRole('combobox', { name: 'Aggiungi una combinazione' }));
      await user.click(screen.getByRole('option', { name: 'PC' }));
      await user.click(screen.getByRole('option', { name: 'NPC' }));

      expect(screen.getByRole('button', { name: 'Aggiungi combinazione' })).toBeDisabled();
    });

    it('lets a Tag be single and part of a combination', async () => {
      const { user } = render([npc, pc], [item('npc')]);

      await user.click(screen.getByRole('combobox', { name: 'Aggiungi una combinazione' }));
      await user.click(screen.getByRole('option', { name: 'NPC' }));
      await user.click(screen.getByRole('option', { name: 'PC' }));

      expect(screen.getByRole('button', { name: 'Aggiungi combinazione' })).toBeEnabled();
    });

    it('removes and reorders a combination like any item', async () => {
      const { onSave, user } = render([npc, pc], [item('npc', 'pc'), item('npc')]);

      await user.click(screen.getByRole('button', { name: 'Sposta NPC + PC giù' }));
      expect(names()).toEqual(['1. #NPC', '2. #NPC + #PC']);
      await user.click(screen.getByRole('button', { name: 'Rimuovi NPC + PC dai Tag principali' }));
      await user.click(saveButton());

      expect(onSave).toHaveBeenCalledWith([item('npc')]);
    });
  });
});
