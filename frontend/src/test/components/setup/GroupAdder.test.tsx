import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { GroupAdder } from '../../../components/setup/GroupAdder';
import type { Tag } from '../../../types/tag';

const tag = (id: string, name: string): Tag => ({ id, name, category: null, mainPosition: null });

const tags = [tag('npc', 'NPC'), tag('pc', 'PC'), tag('place', 'Luogo')];

/** Renders the adder with these items already listed. */
function render(listed: string[][]) {
  const onAdd = vi.fn();
  renderWithProviders(<GroupAdder tags={tags} listed={listed} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: /Aggiungi una voce/ });
const addButton = () => screen.getByRole('button', { name: 'Aggiungi' });

/** Picks these Tags in the field, by name. */
async function pick(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  await user.click(field());
  for (const name of names) await user.click(screen.getByRole('option', { name: `#${name}` }));
}

describe('GroupAdder', () => {
  it('cannot add until a Tag is picked', () => {
    render([]);

    expect(addButton()).toBeDisabled();
  });

  // Spec 25c Decision 2: one Tag is a Main Tag, two or more a combination.
  it('adds one Tag as a Main Tag and clears the field', async () => {
    const { onAdd, user } = render([]);

    await pick(user, 'PC');
    await user.click(addButton());

    expect(onAdd).toHaveBeenCalledWith(['pc']);
    expect(addButton()).toBeDisabled();
  });

  it('adds several Tags as one combination, in the order picked', async () => {
    const { onAdd, user } = render([]);

    await pick(user, 'PC', 'Luogo');
    await user.click(addButton());

    expect(onAdd).toHaveBeenCalledWith(['pc', 'place']);
  });

  it('refuses a Tag that is already a Main Tag, saying why', async () => {
    const { user } = render([['npc']]);

    await pick(user, 'NPC');

    expect(addButton()).toBeDisabled();
    expect(screen.getByText('Questo Tag è già una voce del raggruppamento.')).toBeInTheDocument();
  });

  it('refuses a combination already listed in another order, saying why', async () => {
    const { user } = render([['place', 'pc']]);

    await pick(user, 'PC', 'Luogo');

    expect(addButton()).toBeDisabled();
    expect(screen.getByText('Questa combinazione è già nel raggruppamento.')).toBeInTheDocument();
  });

  it('accepts a Tag that only appears inside a combination', async () => {
    const { user } = render([['place', 'pc']]);

    await pick(user, 'PC');

    expect(addButton()).toBeEnabled();
  });
});
