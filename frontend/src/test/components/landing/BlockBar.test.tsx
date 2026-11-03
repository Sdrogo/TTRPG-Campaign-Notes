import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockBar } from '../../../components/landing/BlockBar';
import type { BlockInput } from '../../../types/landing';
import { matchMediaQueries } from '../../media';
import { tag } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../components/landing/Sortable', () => import('./sortableMock'));

const tags = [tag('t1', 'Tokyo'), tag('t2', 'PNG'), tag('t3', 'Yakuza')];
const documents: BlockInput = { kind: 'documents', heading: null, tagIds: ['t1'], groups: [], mapKind: null, features: [], collapsed: false, moduleId: null };

function bar(block: BlockInput, extra: Partial<Parameters<typeof BlockBar>[0]> = {}) {
  const onChange = vi.fn();
  const onDelete = vi.fn();
  const view = renderWithProviders(
    <BlockBar block={block} tags={tags} mainItems={[]} onChange={onChange} onDelete={onDelete} {...extra} />,
  );
  return { ...view, onChange, onDelete };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('the block bar', () => {
  it('renames the block in place', async () => {
    const { onChange, rerender } = bar(documents);
    expect(screen.getByRole('button', { name: 'Sposta il blocco' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina Documenti · #Tokyo' }));
    const input = screen.getByRole('textbox', { name: 'Titolo del blocco' });
    expect(input).toHaveAttribute('placeholder', 'Documenti · #Tokyo');
    await userEvent.type(input, '  Gente  {Enter}');
    expect(onChange).toHaveBeenCalledWith({ ...documents, heading: 'Gente' });

    rerender(<BlockBar block={{ ...documents, heading: 'Gente' }} tags={tags} mainItems={[]} onChange={onChange} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina Gente' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Titolo del blocco' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina Gente' }));
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Rinomina Gente' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Titolo del blocco' }));
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, heading: null });
  });

  it('adds and removes Tags, keeping the last one', async () => {
    const { onChange, rerender } = bar(documents);
    expect(screen.getByText('#Tokyo').closest('.room-landing-chip')!.querySelector('button')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tag' }));
    const search = screen.getByRole('textbox', { name: 'Cerca un Tag' });
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'yak');
    await userEvent.click(screen.getByRole('button', { name: '#Yakuza' }));
    expect(onChange).toHaveBeenCalledWith({ ...documents, tagIds: ['t1', 't3'] });

    rerender(<BlockBar block={{ ...documents, tagIds: ['t1', 't3'] }} tags={tags} mainItems={[]} onChange={onChange} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Togli #Tokyo' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, tagIds: ['t3'] });
  });

  it('drops a new block whose picker closes empty', async () => {
    const onCancelDraft = vi.fn();
    bar({ ...documents, tagIds: [] }, { initialPicker: 'tags', onCancelDraft });
    expect(screen.getByRole('textbox', { name: 'Cerca un Tag' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onCancelDraft).toHaveBeenCalled();
  });

  it('builds the groups', async () => {
    const mainItems = [{ tagIds: ['t2'] }, { tagIds: ['t2', 'gone'] }, { tagIds: ['t3', 't1'] }];
    const { onChange, rerender } = bar(documents, { mainItems });
    await userEvent.click(screen.getByRole('button', { name: 'Raggruppa' }));
    expect(screen.getByText('Nessun gruppo: i Documenti sono tutti insieme.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Usa i raggruppamenti della Stanza' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, groups: [['t2'], ['t3', 't1']] });

    await userEvent.click(screen.getByRole('button', { name: 'Gruppo' }));
    const add = screen.getByRole('button', { name: 'Aggiungi' });
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: '#PNG' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#Tokyo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#Tokyo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#Yakuza' }));
    await userEvent.click(add);
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, groups: [['t2', 't3']] });
    await userEvent.click(screen.getByRole('button', { name: 'Gruppo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'Gruppo' })).toBeInTheDocument();

    const grouped = { ...documents, groups: [['t2'], ['t3', 't1']] };
    rerender(<BlockBar block={grouped} tags={tags} mainItems={[]} onChange={onChange} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: '2 gruppi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usa i raggruppamenti della Stanza' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sposta #Yakuza + #Tokyo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Togli #PNG' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, groups: [['t3', 't1']] });
    await userEvent.click(screen.getByRole('button', { name: 'Riordina t2,t3+t1' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...documents, groups: [['t3', 't1'], ['t2']] });
    // A group already there can't be added twice.
    await userEvent.click(screen.getByRole('button', { name: 'Gruppo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '#PNG' }));
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
  });

  it('picks which maps a maps block keeps', async () => {
    const maps: BlockInput = { ...documents, kind: 'maps', tagIds: [] };
    const { onChange } = bar(maps);
    expect(screen.getByRole('button', { name: 'Rinomina Mappe' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mappe mostrate: Tutte le mappe' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tutte le mappe' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Mappe mostrate: Tutte le mappe' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Geografiche' }));
    expect(onChange).toHaveBeenCalledWith({ ...maps, mapKind: 'geographic' });
  });

  it('picks, orders and removes Session 0 features', async () => {
    const zero: BlockInput = { ...documents, kind: 'session_zero', tagIds: [], features: ['sessions', 'polls'] };
    const { onChange, rerender } = bar(zero);
    await userEvent.click(screen.getByRole('button', { name: 'Togli Sondaggi' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...zero, features: ['sessions'] });
    await userEvent.click(screen.getByRole('button', { name: 'Riordina sessions,polls' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...zero, features: ['polls', 'sessions'] });
    await userEvent.click(screen.getByRole('button', { name: 'Funzione' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'DDI' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...zero, features: ['sessions', 'polls', 'ddi'] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sessioni' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...zero, features: ['polls'] });

    rerender(
      <BlockBar block={{ ...zero, features: ['polls'] }} tags={tags} mainItems={[]} onChange={onChange} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Sondaggi' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Togli Sondaggi' })).not.toBeInTheDocument();
  });

  it('closes a new Session 0 block picker once a feature is picked', async () => {
    const zero: BlockInput = { ...documents, kind: 'session_zero', tagIds: [], features: [] };
    const { onChange } = bar(zero, { initialPicker: 'features' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Retro' }));
    expect(onChange).toHaveBeenCalledWith({ ...zero, features: ['retro'] });
    expect(screen.queryByRole('checkbox', { name: 'Retro' })).not.toBeInTheDocument();
  });

  it('deletes the block from its menu', async () => {
    const { onDelete } = bar(documents);
    await userEvent.click(screen.getByRole('button', { name: 'Azioni del blocco' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina blocco' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('opens its pickers as a bottom sheet on a phone', async () => {
    restore = matchMediaQueries(['(max-width: 48em)']);
    bar(documents);
    await userEvent.click(screen.getByRole('button', { name: 'Tag' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('textbox', { name: 'Cerca un Tag' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  });
});
