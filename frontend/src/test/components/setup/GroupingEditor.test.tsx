import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { GroupingEditor } from '../../../components/setup/GroupingEditor';
import type { MainItem, Tag } from '../../../types/tag';

/** A Tag; the editor works from the items, not from `mainPosition`. */
const tag = (id: string, name: string): Tag => ({ id, name, category: null, mainPosition: null });

const npc = tag('npc', 'NPC');
const pc = tag('pc', 'PC');
const place = tag('place', 'Luogo');

/** A Main item of the given Tag ids. */
const item = (...tagIds: string[]): MainItem => ({ tagIds });

/** Renders the editor and returns its change spy and a user. */
function render(tags: Tag[], items: MainItem[]) {
  const onChange = vi.fn();
  renderWithProviders(<GroupingEditor tags={tags} items={items} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

/** The text of each row, in order. */
const rows = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.textContent);

describe('GroupingEditor', () => {
  it('lists the items in their order, a combination as #A + #B', () => {
    render([npc, pc, place], [item('pc'), item('npc', 'place')]);

    expect(rows()).toEqual(['1.#PC', '2.#NPC + #Luogo']);
  });

  it('says so when there is nothing to group by', () => {
    render([place], []);

    expect(screen.getByText(/Nessuna voce/)).toBeInTheDocument();
  });

  // Spec 25c: names come from the Tags, so a rename shows at once.
  it('shows the current name of a renamed Tag', () => {
    render([tag('npc', 'PNG'), pc], [item('npc'), item('pc')]);

    expect(rows()).toEqual(['1.#PNG', '2.#PC']);
  });

  it('leaves out, and does not send back, an item whose Tag is gone', async () => {
    const { onChange, user } = render([npc, pc], [item('gone'), item('npc'), item('pc')]);

    expect(rows()).toEqual(['1.#NPC', '2.#PC']);
    await user.click(screen.getByRole('button', { name: 'Sposta NPC giù' }));

    expect(onChange).toHaveBeenCalledWith([item('pc'), item('npc')]);
  });

  it('saves a move up at once', async () => {
    const { onChange, user } = render([npc, pc], [item('npc'), item('pc')]);

    await user.click(screen.getByRole('button', { name: 'Sposta PC su' }));

    expect(onChange).toHaveBeenCalledWith([item('pc'), item('npc')]);
  });

  it('cannot move the first item up or the last one down', () => {
    render([npc, pc], [item('npc'), item('pc')]);

    expect(screen.getByRole('button', { name: 'Sposta NPC su' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta PC giù' })).toBeDisabled();
  });

  it('saves a removal at once', async () => {
    const { onChange, user } = render([npc, pc], [item('npc'), item('pc')]);

    await user.click(screen.getByRole('button', { name: 'Togli NPC dal raggruppamento' }));

    expect(onChange).toHaveBeenCalledWith([item('pc')]);
  });

  it('appends an added item and saves it', async () => {
    const { onChange, user } = render([npc, pc, place], [item('npc')]);

    await user.click(screen.getByRole('combobox', { name: /Aggiungi una voce/ }));
    await user.click(screen.getByRole('option', { name: '#Luogo' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(onChange).toHaveBeenCalledWith([item('npc'), item('place')]);
  });
});
