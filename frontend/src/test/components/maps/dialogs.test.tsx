import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddDocumentsPanel } from '../../../components/maps/AddDocumentsPanel';
import { ArrowDialog } from '../../../components/maps/ArrowDialog';
import { CardDialog } from '../../../components/maps/CardDialog';
import { GroupDialog } from '../../../components/maps/GroupDialog';
import { MapFormModal } from '../../../components/maps/MapFormModal';
import type { Document } from '../../../types/document';
import type { MapArrow, MapCard } from '../../../types/map';
import type { Member } from '../../../types/member';
import { renderWithProviders } from '../../utils';

const arrow: MapArrow = {
  id: 'arrow-1',
  from: { cardId: 'a', groupId: null },
  to: { cardId: 'b', groupId: null },
  direction: 'forward',
  label: 'padre di',
  reverseLabel: null,
  color: 'default',
  masterOnly: false,
};

const textCard: MapCard = {
  id: 'card-1',
  documentId: null,
  text: 'Sire ignoto',
  groupId: null,
  caption: null,
  size: 'normal',
  masterOnly: false,
  color: 'default',
  struck: false,
  x: 0,
  y: 0,
  document: null,
};

describe('ArrowDialog', () => {
  it('edits a two-way arrow with a label towards each end', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <ArrowDialog
        arrow={arrow}
        fromName="Aldric"
        toName="Mira"
        suggestions={['alleato']}
        isMaster
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText('In entrambi'));
    const towardsMira = screen.getByRole('combobox', { name: 'Etichetta verso Mira' });
    await user.clear(towardsMira);
    await user.type(towardsMira, '  figlia ');
    await user.type(screen.getByRole('combobox', { name: 'Etichetta verso Aldric' }), 'padre');
    await user.click(screen.getByRole('radio', { name: 'Verde' }));
    await user.click(screen.getByLabelText('Visibile solo ai Master'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onSave).toHaveBeenCalledWith({
      direction: 'both',
      label: 'figlia',
      reverseLabel: 'padre',
      color: 'green',
      masterOnly: true,
    });
  });

  it('clears empty labels, drops the reverse one on a line and hides Master only from Players', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    renderWithProviders(
      <ArrowDialog
        arrow={{ ...arrow, direction: 'both', reverseLabel: 'figlio' }}
        fromName="A"
        toName="B"
        suggestions={[]}
        isMaster={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Visibile solo ai Master')).not.toBeInTheDocument();
    await user.click(screen.getByText('Solo linea'));
    await user.clear(screen.getByRole('combobox', { name: 'Etichetta' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ direction: 'none', label: null, reverseLabel: null }));

    await user.click(screen.getByRole('button', { name: 'Elimina la freccia' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('sends a blank reverse label as none', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <ArrowDialog
        arrow={{ ...arrow, direction: 'both', label: null }}
        fromName="A"
        toName="B"
        suggestions={[]}
        isMaster={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ label: null, reverseLabel: null }));
  });
});

describe('CardDialog', () => {
  it('writes a new text card', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(<CardDialog isMaster onSave={onSave} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Nuovo testo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Togli dalla mappa' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Testo/), ' Nuove idee ');
    await user.click(screen.getByText('Titolo'));
    await user.click(screen.getByLabelText('Barrato'));
    await user.click(screen.getByLabelText('Visibile solo ai Master'));
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(onSave).toHaveBeenCalledWith({
      text: 'Nuove idee',
      caption: null,
      size: 'title',
      color: 'default',
      struck: true,
      masterOnly: true,
    });
  });

  it('edits a text card and removes it', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderWithProviders(
      <CardDialog card={textCard} isMaster={false} onSave={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog', { name: 'Testo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Visibile solo ai Master')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Togli dalla mappa' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('edits a Document card caption, with the subtitle as placeholder', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const card: MapCard = {
      ...textCard,
      documentId: 'doc-1',
      text: null,
      caption: 'Neonata',
      document: { id: 'doc-1', name: 'Mira', subtitle: 'La Idol', image: null, tagIds: [] },
    };
    renderWithProviders(<CardDialog card={card} isMaster onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Carta: Mira' })).toBeInTheDocument();
    const caption = screen.getByLabelText('Didascalia');
    expect(caption).toHaveAttribute('placeholder', 'La Idol');
    expect(screen.queryByLabelText('Visibile solo ai Master')).not.toBeInTheDocument();
    await user.clear(caption);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ caption: null }));
  });

  it('has no placeholder for a Document without subtitle', () => {
    const card: MapCard = {
      ...textCard,
      documentId: 'doc-1',
      text: null,
      document: { id: 'doc-1', name: 'Mira', subtitle: null, image: null, tagIds: [] },
    };
    renderWithProviders(<CardDialog card={card} isMaster onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Didascalia')).not.toHaveAttribute('placeholder');
  });
});

describe('GroupDialog', () => {
  it('edits a group and removes it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const group = { id: 'g', title: null, color: 'default' as const, struck: false, x: 0, y: 0, width: 100, height: 100 };
    renderWithProviders(<GroupDialog group={group} onSave={onSave} onDelete={onDelete} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Titolo'), ' Corte ');
    await user.click(screen.getByRole('radio', { name: 'Oro' }));
    await user.click(screen.getByLabelText('Barrato'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith({ title: 'Corte', color: 'gold', struck: true });

    await user.click(screen.getByRole('button', { name: 'Rimuovi il gruppo' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('saves a blank title as none', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const group = { id: 'g', title: 'Corte', color: 'red' as const, struck: true, x: 0, y: 0, width: 100, height: 100 };
    renderWithProviders(<GroupDialog group={group} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Titolo'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith({ title: null, color: 'red', struck: true });
  });
});

describe('AddDocumentsPanel', () => {
  const documents = [
    { id: 'd1', name: 'Thorn', subtitle: null, images: [], tagIds: ['npc'] },
    { id: 'd2', name: 'Mira', subtitle: 'La Idol', images: [], tagIds: [] },
    { id: 'd3', name: 'Aldric', subtitle: null, images: [], tagIds: [] },
  ] as unknown as Document[];

  it('searches, greys out what is on the map and adds the chosen ones', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <AddDocumentsPanel
        opened
        onClose={onClose}
        documents={documents}
        tags={[{ id: 'npc', name: 'NPC', category: null, mainPosition: null } as never]}
        onMapIds={new Set(['d3'])}
        onAdd={onAdd}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /Aldric/ })).toBeDisabled();
    expect(screen.getByText('Già sulla mappa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi 0 Documenti' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Mira · La Idol' }));
    await user.click(screen.getByRole('checkbox', { name: 'Thorn' }));
    await user.click(screen.getByRole('checkbox', { name: 'Thorn' }));
    await user.type(screen.getByRole('textbox', { name: 'Cerca per nome' }), 'zzz');
    expect(screen.getByText('Nessun risultato')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi 1 Documento' }));
    expect(onAdd).toHaveBeenCalledWith([
      { id: 'd2', name: 'Mira', subtitle: 'La Idol', image: null, tagIds: [] },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no Tag filter in a Room without Tags', () => {
    renderWithProviders(
      <AddDocumentsPanel opened onClose={vi.fn()} documents={[]} tags={[]} onMapIds={new Set()} onAdd={vi.fn()} />,
    );
    expect(screen.queryByPlaceholderText(/Tag/)).not.toBeInTheDocument();
  });
});

describe('MapFormModal', () => {
  const members = [
    { userId: 'user-1', displayName: 'Io', role: 'master' },
    { userId: 'user-2', displayName: 'Giulia', role: 'player' },
  ] as unknown as Member[];

  it('fills the name, description and a Selective grant', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <MapFormModal
        title="Nuova mappa"
        initialValues={{ name: '', description: '', visibility: 'room', selectiveUserIds: [] }}
        members={members}
        creatorId="user-1"
        submitLabel="Crea"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Crea' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Nome/), 'La Corte');
    await user.type(screen.getByLabelText('Descrizione'), 'Chi serve chi');
    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(await screen.findByRole('option', { name: /Selettivo/ }));
    await user.click(screen.getByRole('combobox', { name: 'Membri che possono vedere la mappa' }));
    await user.click(await screen.findByText('Giulia'));
    // The creator always sees the map: not offered.
    expect(screen.queryByRole('option', { name: 'Io' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crea' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'La Corte',
      description: 'Chi serve chi',
      visibility: 'selective',
      selectiveUserIds: ['user-2'],
    });
  });

  it('shows an error', () => {
    renderWithProviders(
      <MapFormModal
        title="Impostazioni"
        initialValues={{ name: 'Corte', description: '', visibility: 'selective', selectiveUserIds: ['user-2'] }}
        members={members}
        creatorId="user-1"
        submitLabel="Salva"
        submitting
        error="Una stanza può avere al massimo 100 mappe"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Una stanza può avere al massimo 100 mappe')).toBeInTheDocument();
  });
});
