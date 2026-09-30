import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { MainTagsEditor } from './MainTagsEditor';
import type { Tag } from '../../types/tag';

const tag = (id: string, name: string, mainPosition: number | null): Tag => ({
  id,
  name,
  category: null,
  mainPosition,
});

const npc = tag('npc', 'NPC', 0);
const pc = tag('pc', 'PC', 1);
const place = tag('place', 'Luogo', null);

function render(tags: Tag[], saving = false) {
  const onSave = vi.fn();
  renderWithProviders(<MainTagsEditor tags={tags} saving={saving} onSave={onSave} />);
  return { onSave, user: userEvent.setup() };
}

const names = () => screen.getAllByRole('listitem').map((item) => item.textContent);

describe('MainTagsEditor', () => {
  // Spec 11: the list shows the saved order, which is the Documents page's.
  it('lists the Main Tags in their saved order', () => {
    render([pc, npc, place]);

    expect(names()).toEqual(['1. #NPC', '2. #PC']);
  });

  it('says so when no Tag is a Main Tag', () => {
    render([place]);

    expect(screen.getByText(/Nessun Tag principale/)).toBeInTheDocument();
  });

  it('cannot save until something changed', () => {
    render([npc, pc]);

    expect(screen.getByRole('button', { name: 'Salva ordine' })).toBeDisabled();
  });

  it('moves a Tag down and saves the new order', async () => {
    const { onSave, user } = render([npc, pc]);

    await user.click(screen.getByRole('button', { name: 'Sposta NPC giù' }));
    expect(names()).toEqual(['1. #PC', '2. #NPC']);
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    expect(onSave).toHaveBeenCalledWith(['pc', 'npc']);
  });

  it('moves a Tag up', async () => {
    const { user } = render([npc, pc]);

    await user.click(screen.getByRole('button', { name: 'Sposta PC su' }));

    expect(names()).toEqual(['1. #PC', '2. #NPC']);
  });

  it('cannot move the first Tag up or the last one down', () => {
    render([npc, pc]);

    expect(screen.getByRole('button', { name: 'Sposta NPC su' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sposta PC giù' })).toBeDisabled();
  });

  it('removes a Tag from the Main Tags, and offers it again', async () => {
    const { onSave, user } = render([npc, pc]);

    await user.click(screen.getByRole('button', { name: 'Rimuovi NPC dai Tag principali' }));
    expect(names()).toEqual(['1. #PC']);
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    expect(onSave).toHaveBeenCalledWith(['pc']);
    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));
    expect(screen.getByRole('option', { name: 'NPC' })).toBeInTheDocument();
  });

  it('adds another Tag at the end', async () => {
    const { onSave, user } = render([npc, place]);

    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));
    await user.click(screen.getByRole('option', { name: 'Luogo' }));
    expect(names()).toEqual(['1. #NPC', '2. #Luogo']);
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    expect(onSave).toHaveBeenCalledWith(['npc', 'place']);
  });

  it('does not offer a Tag that is already a Main Tag', async () => {
    const { user } = render([npc, place]);

    await user.click(screen.getByRole('combobox', { name: 'Aggiungi un Tag principale' }));

    expect(screen.queryByRole('option', { name: 'NPC' })).not.toBeInTheDocument();
  });

  it('says so when every Tag is already a Main Tag', () => {
    render([npc]);

    expect(screen.getByText('Ogni Tag è già un Tag principale.')).toBeInTheDocument();
  });

  it('can save an emptied list, which clears the Main Tags', async () => {
    const { onSave, user } = render([npc]);

    await user.click(screen.getByRole('button', { name: 'Rimuovi NPC dai Tag principali' }));
    await user.click(screen.getByRole('button', { name: 'Salva ordine' }));

    expect(onSave).toHaveBeenCalledWith([]);
  });
});
