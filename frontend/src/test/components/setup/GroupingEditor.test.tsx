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

/**
 * Renders the editor and returns its change spies and a user. The maps row
 * starts on top unless placed, so the items' own tests skip it in `rows`.
 */
function render(tags: Tag[], items: MainItem[], mapsPosition = 0) {
  const onChange = vi.fn();
  const onMapsPositionChange = vi.fn();
  renderWithProviders(
    <GroupingEditor
      tags={tags}
      items={items}
      onChange={onChange}
      mapsPosition={mapsPosition}
      onMapsPositionChange={onMapsPositionChange}
    />,
  );
  return { onChange, onMapsPositionChange, user: userEvent.setup() };
}

/** The text of each item row, in order (the maps row left out). */
const rows = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.textContent)
    .filter((text) => text !== 'Riga delle Mappe');

/** Every row's text, the maps row included. */
const allRows = () =>
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

  it('cannot move the first entry up or the last one down', () => {
    render([npc, pc], [item('npc'), item('pc')], 2);

    expect(screen.getByRole('button', { name: 'Sposta NPC su' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta Riga delle Mappe giù' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta PC giù' })).toBeEnabled();
  });

  it('shows the maps row where it is placed, after its items', () => {
    render([npc, pc, place], [item('npc'), item('pc'), item('place')], 1);

    expect(allRows()).toEqual(['1.#NPC', 'Riga delle Mappe', '2.#PC', '3.#Luogo']);
  });

  it('shows a maps row placed past the last item after them all', () => {
    render([npc, pc], [item('npc'), item('pc')], 7);

    expect(allRows()).toEqual(['1.#NPC', '2.#PC', 'Riga delle Mappe']);
  });

  it('moves the maps row without touching the items', async () => {
    const { onChange, onMapsPositionChange, user } = render([npc, pc], [item('npc'), item('pc')], 0);

    await user.click(screen.getByRole('button', { name: 'Sposta Riga delle Mappe giù' }));

    expect(onMapsPositionChange).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moving an item past the maps row moves the row, not the order', async () => {
    const { onChange, onMapsPositionChange, user } = render([npc, pc], [item('npc'), item('pc')], 1);

    await user.click(screen.getByRole('button', { name: 'Sposta PC su' }));

    expect(onMapsPositionChange).toHaveBeenCalledWith(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the maps row after the same items when one before it is removed', async () => {
    const { onChange, onMapsPositionChange, user } = render([npc, pc], [item('npc'), item('pc')], 2);

    await user.click(screen.getByRole('button', { name: 'Togli NPC dal raggruppamento' }));

    expect(onChange).toHaveBeenCalledWith([item('pc')]);
    expect(onMapsPositionChange).toHaveBeenCalledWith(1);
  });

  it('leaves the maps row alone when an item after it is removed', async () => {
    const { onMapsPositionChange, user } = render([npc, pc], [item('npc'), item('pc')], 1);

    await user.click(screen.getByRole('button', { name: 'Togli PC dal raggruppamento' }));

    expect(onMapsPositionChange).not.toHaveBeenCalled();
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
