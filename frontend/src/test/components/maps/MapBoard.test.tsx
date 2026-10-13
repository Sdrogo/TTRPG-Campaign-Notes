import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapBoard } from '../../../components/maps/MapBoard';
import type { Document } from '../../../types/document';
import type { Board, MapCard } from '../../../types/map';
import { flow } from '../../xyflowMock';
import { renderWithProviders } from '../../utils';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ...(await import('../../xyflowMock')).xyflowMock,
}));

function card(id: string, overrides: Partial<MapCard> = {}): MapCard {
  return {
    id,
    documentId: null,
    text: `testo ${id}`,
    groupId: null,
    caption: null,
    imageId: null,
    size: 'normal',
    masterOnly: false,
    color: 'default',
    struck: false,
    x: 0,
    y: 0,
    document: null,
    ...overrides,
  };
}

const initial: Board = {
  groups: [
    {
      id: 'g',
      title: 'Corte',
      color: 'red',
      struck: false,
      x: 300,
      y: 0,
      width: 300,
      height: 300,
    },
    {
      id: 'h',
      title: null,
      color: 'default',
      struck: false,
      x: 1000,
      y: 0,
      width: 100,
      height: 100,
    },
  ],
  cards: [
    card('mira', {
      documentId: 'doc-mira',
      text: null,
      document: {
        id: 'doc-mira',
        name: 'Mira',
        subtitle: 'La Idol',
        image: null,
        tagIds: [],
      },
    }),
    card('thorn', {
      documentId: 'doc-thorn',
      text: null,
      groupId: 'g',
      x: 10,
      y: 50,
      document: {
        id: 'doc-thorn',
        name: 'Thorn',
        subtitle: null,
        image: null,
        tagIds: [],
      },
    }),
    card('fire'),
    // A card whose group isn't on this viewer's board is drawn free.
    card('lost', { groupId: 'gone' }),
  ],
  arrows: [
    {
      id: 'both',
      from: { cardId: 'mira', groupId: null },
      to: { cardId: 'thorn', groupId: null },
      direction: 'both',
      label: 'alleata',
      reverseLabel: 'alleato',
      labelPosition: null,
      reverseLabelPosition: null,
      labelOffset: null,
      reverseLabelOffset: null,
      color: 'green',
      masterOnly: false,
    },
    {
      id: 'line',
      from: { cardId: 'fire', groupId: null },
      to: { cardId: null, groupId: 'h' },
      direction: 'none',
      label: null,
      reverseLabel: null,
      labelPosition: null,
      reverseLabelPosition: null,
      labelOffset: null,
      reverseLabelOffset: null,
      color: 'default',
      masterOnly: false,
    },
    {
      id: 'forward',
      from: { cardId: null, groupId: 'g' },
      to: { cardId: 'fire', groupId: null },
      direction: 'forward',
      label: null,
      reverseLabel: null,
      labelPosition: null,
      reverseLabelPosition: null,
      labelOffset: null,
      reverseLabelOffset: null,
      color: 'default',
      masterOnly: false,
    },
  ],
};

const documents = [
  { id: 'doc-mira', name: 'Mira', subtitle: null, images: [], tagIds: [] },
  { id: 'doc-aldric', name: 'Aldric', subtitle: null, images: [], tagIds: [] },
] as unknown as Document[];

function renderBoard({ editable = true, isMaster = true, docs = documents } = {}) {
  const changes: Board[] = [];
  function Harness() {
    const [board, setBoard] = useState(initial);
    return (
      <MapBoard
        roomId="room-1"
        board={board}
        editable={editable}
        isMaster={isMaster}
        documents={docs}
        tags={[]}
        onChange={(next) => {
          changes.push(next);
          setBoard(next);
        }}
      />
    );
  }
  renderWithProviders(<Harness />);
  const last = () => changes[changes.length - 1];
  return { changes, last, user: userEvent.setup() };
}

type Handler = (...args: unknown[]) => unknown;
const call = (name: string, ...args: unknown[]) => act(() => (flow.props[name] as Handler)(...args) as void);
const node = (id: string) => flow.props.nodes.find((candidate) => candidate.id === id)!;

beforeEach(() => {
  flow.reset();
});

describe('MapBoard', () => {
  it('draws groups before their cards, and the arrows with their heads', () => {
    renderBoard();
    const { nodes, edges } = flow.props;
    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      ['g', 'mapGroup'],
      ['h', 'mapGroup'],
      ['mira', 'documentCard'],
      ['thorn', 'documentCard'],
      ['fire', 'textCard'],
      ['lost', 'textCard'],
    ]);
    expect((node('thorn') as unknown as { parentId: string }).parentId).toBe('g');
    expect((node('lost') as unknown as { parentId?: string }).parentId).toBeUndefined();
    const byId = Object.fromEntries(edges.map((edge) => [edge.id, edge]));
    expect(byId.both.markerStart).toBeDefined();
    expect(byId.both.markerEnd).toBeDefined();
    expect(byId.line.markerEnd).toBeUndefined();
    expect(byId.forward.markerStart).toBeUndefined();
    expect(byId.forward.source).toBe('g');
    expect(screen.getByRole('button', { name: 'Raggruppa' })).toBeDisabled();
  });

  it('is only a view when not editable', async () => {
    const { changes } = renderBoard({ editable: false });
    expect(screen.queryByRole('button', { name: 'Aggiungi Documenti' })).not.toBeInTheDocument();
    expect(flow.props.deleteKeyCode).toBeNull();
    call('onEdgeClick', null, { id: 'both' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changes).toEqual([]);
  });

  it('selects by dragging on the board and saves a selection moved as a whole', () => {
    const { last } = renderBoard();
    expect(flow.props.selectionOnDrag).toBe(true);
    expect(flow.props.panOnDrag).toEqual([1, 2]);
    expect(screen.getByText(/Trascina sullo sfondo/)).toBeInTheDocument();
    call('onSelectionDragStop', null, [{ ...node('fire'), position: { x: 700, y: 40 } }]);
    expect(last().cards.find((c) => c.id === 'fire')).toMatchObject({ x: 700, y: 40 });
  });

  it('keeps panning with a finger on a touch screen, with no selection box', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query === '(pointer: coarse)',
    })) as typeof original;
    try {
      renderBoard();
      expect(flow.props.selectionOnDrag).toBe(false);
      expect(flow.props.panOnDrag).toBe(true);
      expect(screen.queryByText(/Trascina sullo sfondo/)).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('keeps panning with a plain drag when not editable', () => {
    renderBoard({ editable: false });
    expect(flow.props.selectionOnDrag).toBe(false);
    expect(flow.props.panOnDrag).toBe(true);
  });

  it('moves groups first, then drops cards into or out of groups', () => {
    const { last } = renderBoard();
    flow.measured.mira = { width: 160, height: 80 };
    call('onNodeDragStop', null, null, [
      { ...node('thorn'), position: { x: 10, y: 60 } },
      { ...node('g'), position: { x: 320, y: 0 } },
      { ...node('mira'), position: { x: 350, y: 100 } },
      { ...node('fire'), position: { x: 2000, y: 2000 } },
    ]);
    const board = last();
    expect(board.groups[0]).toMatchObject({ x: 320, y: 0 });
    expect(board.cards.find((c) => c.id === 'thorn')).toMatchObject({
      groupId: 'g',
      x: 10,
      y: 60,
    });
    expect(board.cards.find((c) => c.id === 'mira')).toMatchObject({
      groupId: 'g',
      x: 30,
      y: 100,
    });
    expect(board.cards.find((c) => c.id === 'fire')).toMatchObject({
      groupId: null,
      x: 2000,
    });
  });

  it('draws an arrow between two cards and opens it', async () => {
    const { last, changes, user } = renderBoard();
    call('onConnect', { source: 'fire', target: 'fire' });
    expect(changes).toEqual([]);

    call('onConnect', { source: 'fire', target: 'mira' });
    const added = last().arrows[3];
    expect(added).toMatchObject({
      from: { cardId: 'fire' },
      to: { cardId: 'mira' },
      direction: 'forward',
    });
    const dialog = screen.getByRole('dialog', { name: 'Relazione' });

    await user.type(within(dialog).getByRole('textbox', { name: 'Etichetta' }), 'teme');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(last().arrows[3].label).toBe('teme');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens an arrow on click, names both ends and deletes it', async () => {
    const { last, user } = renderBoard();
    call('onEdgeClick', null, { id: 'both' });
    expect(screen.getByRole('textbox', { name: 'Etichetta verso Thorn' })).toHaveValue('alleata');
    expect(screen.getByRole('textbox', { name: 'Etichetta verso Mira' })).toHaveValue('alleato');
    await user.click(screen.getByRole('button', { name: 'Elimina la relazione' }));
    expect(last().arrows.map((a) => a.id)).toEqual(['line', 'forward']);
  });

  it('names a text card, a titled and an untitled group as arrow ends', async () => {
    const { user } = renderBoard();
    call('onEdgeClick', null, { id: 'line' });
    await user.click(screen.getByText('In entrambi'));
    expect(
      screen.getByRole('textbox', {
        name: 'Etichetta verso Gruppo senza titolo',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Etichetta verso testo fire' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    call('onEdgeClick', null, { id: 'forward' });
    await user.click(screen.getByText('In entrambi'));
    expect(screen.getByRole('textbox', { name: 'Etichetta verso Corte' })).toBeInTheDocument();
  });

  it('opens an arrow from its label', async () => {
    const { user } = renderBoard();
    await user.click(screen.getByRole('button', { name: 'Modifica la relazione: alleato' }));
    expect(screen.getByRole('dialog', { name: 'Relazione' })).toBeInTheDocument();
  });

  it('saves where each label of an arrow was dropped', () => {
    const { last } = renderBoard();
    const data = () => flow.props.edges.find((edge) => edge.id === 'both')!.data as {
      onMoveLabel: (
        id: string,
        which: 'label' | 'reverse',
        position: number,
        offset: number,
      ) => void;
    };
    act(() => data().onMoveLabel('both', 'label', 0.6, -15));
    act(() => data().onMoveLabel('both', 'reverse', 0.2, 40));
    const moved = last().arrows.find((arrow) => arrow.id === 'both')!;
    expect(moved.labelPosition).toBe(0.6);
    expect(moved.reverseLabelPosition).toBe(0.2);
    expect([moved.labelOffset, moved.reverseLabelOffset]).toEqual([-15, 40]);
  });

  it('deletes only what was selected: a group leaves its cards behind', async () => {
    const { last } = renderBoard();
    const filtered = (await (flow.props.onBeforeDelete as Handler)({
      nodes: [
        { ...node('g'), selected: true },
        { ...node('thorn'), selected: false },
      ],
      edges: [
        { id: 'both', source: 'mira', target: 'thorn', selected: false },
        { id: 'forward', source: 'g', target: 'fire', selected: false },
        { id: 'line', source: 'fire', target: 'h', selected: true },
      ],
    })) as { nodes: { id: string }[]; edges: { id: string }[] };
    expect(filtered.nodes.map((n) => n.id)).toEqual(['g']);
    expect(filtered.edges.map((e) => e.id)).toEqual(['forward', 'line']);

    call('onDelete', {
      nodes: [node('g'), node('fire')],
      edges: [{ id: 'both' }],
    });
    const board = last();
    expect(board.groups.map((g) => g.id)).toEqual(['h']);
    expect(board.cards.map((c) => c.id)).toEqual(['mira', 'thorn', 'lost']);
    expect(board.cards.find((c) => c.id === 'thorn')).toMatchObject({
      groupId: null,
      x: 310,
      y: 50,
    });
    expect(board.arrows).toEqual([]);
  });

  it('frames the selected cards in a new group and opens it', async () => {
    const { last, user } = renderBoard();
    flow.measured.fire = { width: 100, height: 40 };
    flow.measured.mira = { width: 0 };
    call('onNodesChange', [
      { type: 'select', id: 'fire', selected: true },
      { type: 'select', id: 'mira', selected: true },
      { type: 'select', id: 'g', selected: true },
    ]);
    await user.click(screen.getByRole('button', { name: 'Raggruppa' }));
    const board = last();
    expect(board.groups).toHaveLength(3);
    expect(board.cards.find((c) => c.id === 'fire')?.groupId).toBe(board.groups[2].id);
    // The selection survives the rebuild that follows the change.
    expect(node('fire').selected).toBe(true);

    const dialog = screen.getByRole('dialog', { name: 'Gruppo' });
    await user.type(within(dialog).getByLabelText('Titolo'), 'Nemici');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(last().groups[2].title).toBe('Nemici');
  });

  it('edits and removes a group from its pencil, and resizes it', async () => {
    const { last, user } = renderBoard();
    await user.click(screen.getAllByRole('button', { name: 'resize' })[0]);
    expect(last().groups[0]).toMatchObject({
      x: 5,
      y: 6,
      width: 400,
      height: 300,
    });

    await user.click(screen.getAllByRole('button', { name: 'Modifica il gruppo' })[0]);
    await user.click(screen.getByRole('button', { name: 'Rimuovi il gruppo' }));
    expect(last().groups.map((g) => g.id)).toEqual(['h']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the image picked for a Document card, and its favorite again once unpicked', async () => {
    const images = [
      { id: 'a', url: 'http://img/a', isFavorite: true },
      { id: 'b', url: 'http://img/b', isFavorite: false },
    ];
    const docs = [{ ...documents[0], images }, documents[1]] as unknown as Document[];
    const { last, user } = renderBoard({ docs });

    await user.click(screen.getByRole('button', { name: 'Modifica la carta: Mira' }));
    await user.click(screen.getByRole('button', { name: 'Immagine 2' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(last().cards[0]).toMatchObject({ imageId: 'b', document: { image: images[1] } });

    await user.click(screen.getByRole('button', { name: 'Modifica la carta: Mira' }));
    await user.click(screen.getByRole('button', { name: 'Immagine 1' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(last().cards[0]).toMatchObject({ imageId: null, document: { image: images[0] } });
  });

  it('edits a Document card caption and takes a card off the map', async () => {
    const { last, user } = renderBoard();
    await user.click(screen.getByRole('button', { name: 'Modifica la carta: Mira' }));
    await user.type(screen.getByLabelText('Didascalia'), 'Neonata');
    await user.click(screen.getByRole('radio', { name: 'Viola' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(last().cards[0]).toMatchObject({ caption: 'Neonata', color: 'purple', size: 'normal', masterOnly: false, text: null });

    await user.click(screen.getByRole('button', { name: 'Modifica la carta: Thorn' }));
    await user.click(screen.getByRole('button', { name: 'Togli dalla mappa' }));
    expect(last().cards.map((c) => c.id)).toEqual(['mira', 'fire', 'lost']);
    expect(last().arrows.map((a) => a.id)).toEqual(['line', 'forward']);
  });

  it('edits a text card', async () => {
    const { last, user } = renderBoard();
    await user.click(screen.getAllByRole('button', { name: 'Modifica il testo' })[0]);
    const text = screen.getByRole('textbox', { name: /Testo/ });
    await user.clear(text);
    await user.type(text, 'La notte');
    await user.click(screen.getByLabelText('Visibile solo ai Master'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(last().cards.find((c) => c.id === 'fire')).toMatchObject({ text: 'La notte', masterOnly: true, caption: null });
  });

  it('adds a text card and Documents at the center of the view', async () => {
    const { last, user } = renderBoard({ isMaster: false });
    await user.click(screen.getByRole('button', { name: 'Aggiungi testo' }));
    expect(screen.queryByLabelText('Visibile solo ai Master')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Testo/), 'Nuove idee');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(last().cards[4]).toMatchObject({
      text: 'Nuove idee',
      documentId: null,
    });

    await user.click(screen.getByRole('button', { name: 'Aggiungi Documenti' }));
    expect(screen.getByRole('checkbox', { name: 'Mira' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Aldric' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi 1 Documento' }));
    expect(last().cards[5]).toMatchObject({
      documentId: 'doc-aldric',
      document: { name: 'Aldric' },
    });
  });

  it('closes a dialog without changing anything', async () => {
    const { changes, user } = renderBoard();
    await user.click(screen.getByRole('button', { name: 'Aggiungi testo' }));
    await user.keyboard('{Escape}');
    expect(changes).toEqual([]);
  });
});
