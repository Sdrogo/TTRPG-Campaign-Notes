import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_SIZE,
  GROUP_PADDING,
  absolutePosition,
  addArrow,
  addDocumentCards,
  addTextCard,
  arrowEnds,
  cardImage,
  colorValue,
  MAP_COLORS,
  dropCard,
  endId,
  endOf,
  groupCards,
  newId,
  parallelShift,
  shiftParallel,
  labelSize,
  placeLabel,
  offsetFromLine,
  pointBeside,
  projectOnLine,
  pointAlong,
  removeArrow,
  removeCards,
  removeGroup,
  toBoardBody,
  toMap,
  toMapBody,
  toMapDetail,
  toMapDocument,
  updateArrow,
  updateCard,
  updateGroup,
  type RawMapDetail,
} from '../../lib/maps';
import type { Board, MapArrow, MapCard, MapGroup } from '../../types/map';
import type { Document } from '../../types/document';
import { rawMap, rawMapDetail } from '../fixtures';

function card(id: string, overrides: Partial<MapCard> = {}): MapCard {
  return {
    id,
    documentId: null,
    text: id,
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

function group(id: string, overrides: Partial<MapGroup> = {}): MapGroup {
  return {
    id,
    title: null,
    color: 'default',
    struck: false,
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    ...overrides,
  };
}

function arrow(id: string, from: string, to: string, overrides: Partial<MapArrow> = {}): MapArrow {
  return {
    id,
    from: { cardId: from, groupId: null },
    to: { cardId: to, groupId: null },
    direction: 'forward',
    label: null,
    reverseLabel: null,
    labelPosition: null,
    reverseLabelPosition: null,
    labelOffset: null,
    reverseLabelOffset: null,
    color: 'default',
    masterOnly: false,
    ...overrides,
  };
}

describe('the wire shape', () => {
  it('reads a map and its board', () => {
    expect(toMap(rawMap({ selective_user_ids: null, can_edit: false }) as never)).toEqual({
      id: 'map-1',
      roomId: 'room-1',
      name: 'La Corte',
      description: 'Chi serve chi',
      visibility: 'room',
      selectiveUserIds: null,
      createdBy: 'user-1',
      createdAt: '2026-10-12T10:00:00Z',
      updatedAt: '2026-10-12T10:00:00Z',
      documentCount: 2,
      canEdit: false,
    });
    const detail = toMapDetail(rawMapDetail() as unknown as RawMapDetail);
    expect(detail.groups[0]).toMatchObject({
      id: 'group-1',
      title: 'Avversari',
      width: 300,
    });
    expect(detail.cards[0]).toMatchObject({
      documentId: 'doc-1',
      masterOnly: false,
      document: { name: 'Mira', subtitle: 'La Idol', image: null, tagIds: [] },
    });
    expect(detail.cards[1].document?.image).toEqual({
      id: 'image-1',
      url: 'http://signed/image-1.webp',
      isFavorite: false,
    });
    expect(detail.cards[2].document).toBeNull();
    expect(detail.arrows[0]).toEqual({
      id: 'arrow-1',
      from: { cardId: 'card-1', groupId: null },
      to: { cardId: 'card-2', groupId: null },
      direction: 'both',
      label: 'alleata',
      reverseLabel: 'alleato',
      labelPosition: null,
      reverseLabelPosition: null,
      labelOffset: null,
      reverseLabelOffset: null,
      color: 'green',
      masterOnly: false,
    });
  });

  it('writes the board back without the Documents and drops a one-way reverse label', () => {
    const detail = toMapDetail(rawMapDetail() as unknown as RawMapDetail);
    const body = toBoardBody({
      ...detail,
      arrows: [...detail.arrows, arrow('arrow-2', 'card-1', 'card-3', { reverseLabel: 'stale' })],
    });
    expect(body.cards[0]).toEqual({
      id: 'card-1',
      document_id: 'doc-1',
      text: null,
      group_id: null,
      caption: null,
      image_id: null,
      size: 'normal',
      master_only: false,
      color: 'default',
      struck: false,
      x: 0,
      y: 0,
    });
    expect(body.groups[0]).toEqual(rawMapDetail().groups[0]);
    expect(body.arrows[0]).toMatchObject({
      from_end: { card_id: 'card-1', group_id: null },
      reverse_label: 'alleato',
    });
    expect(body.arrows[1].reverse_label).toBeNull();
  });

  it('keeps where a label was dragged to, and drops the place of a label that is gone', () => {
    const detail = toMapDetail({
      ...rawMapDetail(),
      arrows: [
        {
          ...rawMapDetail().arrows[0],
          label_position: 0.2,
          reverse_label_position: 0.7,
          label_offset: -30,
          reverse_label_offset: 12,
        },
      ],
    } as unknown as RawMapDetail);
    expect([detail.arrows[0].labelPosition, detail.arrows[0].reverseLabelPosition]).toEqual([
      0.2, 0.7,
    ]);
    const kept = toBoardBody(detail).arrows[0];
    expect([kept.label_position, kept.reverse_label_position]).toEqual([0.2, 0.7]);
    expect([detail.arrows[0].labelOffset, detail.arrows[0].reverseLabelOffset]).toEqual([-30, 12]);
    expect([kept.label_offset, kept.reverse_label_offset]).toEqual([-30, 12]);

    const cleared = toBoardBody({
      ...detail,
      arrows: [{ ...detail.arrows[0], label: null, direction: 'forward' as const }],
    }).arrows[0];
    expect([cleared.label_position, cleared.reverse_label_position]).toEqual([null, null]);
    expect([cleared.label_offset, cleared.reverse_label_offset]).toEqual([null, null]);
  });

  it('finds how far to the side of a line a point is, and puts a point there', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    // y grows downward, so below the line is to the right of the way along it.
    expect(offsetFromLine(from, to, { x: 40, y: 25 })).toBe(25);
    expect(offsetFromLine(from, to, { x: 40, y: -10 })).toBe(-10);
    expect(offsetFromLine(from, from, { x: 5, y: 5 })).toBe(0);
    // Dragged farther than the board allows, it stops at the limit.
    expect(offsetFromLine(from, to, { x: 40, y: 99999 })).toBe(2000);
    expect(offsetFromLine(from, to, { x: 40, y: -99999 })).toBe(-2000);
    expect(pointBeside(from, to, 0.5, 25)).toEqual({ x: 50, y: 25 });
    expect(pointBeside(from, to, 0.5, -10)).toEqual({ x: 50, y: -10 });
    expect(pointBeside(from, from, 0.5, 25)).toEqual(from);
    const slanted = pointBeside({ x: 0, y: 0 }, { x: 0, y: 100 }, 0.5, 10);
    expect(slanted.x).toBeCloseTo(-10);
    expect(slanted.y).toBeCloseTo(50);
    expect(offsetFromLine({ x: 0, y: 0 }, { x: 0, y: 100 }, slanted)).toBeCloseTo(10);
  });

  it('finds how far along a line a point falls, clamped to the line', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    expect(projectOnLine(from, to, { x: 25, y: 40 })).toBe(0.25);
    expect(projectOnLine(from, to, { x: -50, y: 0 })).toBe(0);
    expect(projectOnLine(from, to, { x: 500, y: 9 })).toBe(1);
    expect(projectOnLine(from, from, { x: 3, y: 3 })).toBe(0.5);
  });

  it('sends Selective grants only at the Selective level', () => {
    const values = {
      name: 'Corte',
      description: '',
      visibility: 'room' as const,
      selectiveUserIds: ['u'],
    };
    expect(toMapBody(values).selective_user_ids).toEqual([]);
    expect(toMapBody({ ...values, visibility: 'selective' }).selective_user_ids).toEqual(['u']);
  });

  it('keeps the image chosen for a card through a round trip', () => {
    const raw = rawMapDetail();
    raw.cards[1] = { ...raw.cards[1], image_id: 'image-2' } as unknown as (typeof raw.cards)[number];
    const detail = toMapDetail(raw as unknown as RawMapDetail);
    expect(detail.cards[1].imageId).toBe('image-2');
    expect(detail.cards[0].imageId).toBeNull();
    expect(toBoardBody(detail).cards[1].image_id).toBe('image-2');
  });

  it('shows the image chosen for a card, else the favorite, else none', () => {
    const images = [
      { id: 'a', url: 'a', isFavorite: true },
      { id: 'b', url: 'b', isFavorite: false },
    ];
    expect(cardImage(images, 'b')).toBe(images[1]);
    expect(cardImage(images, null)).toBe(images[0]);
    expect(cardImage(images, 'gone')).toBe(images[0]);
    expect(cardImage([], 'b')).toBeUndefined();
  });

  it('takes a Document card from the Room list, leading with its favorite image', () => {
    const document = {
      id: 'doc-1',
      name: 'Mira',
      subtitle: null,
      images: [
        { id: 'a', url: 'a', isFavorite: false },
        { id: 'b', url: 'b', isFavorite: true },
      ],
      tagIds: ['npc'],
    } as unknown as Document;
    expect(toMapDocument(document)).toEqual({
      id: 'doc-1',
      name: 'Mira',
      subtitle: null,
      image: { id: 'b', url: 'b', isFavorite: true },
      tagIds: ['npc'],
    });
    expect(toMapDocument({ ...document, images: [] }).image).toBeNull();
  });
});

describe('looks', () => {
  it('maps every color to a theme value', () => {
    expect(colorValue('default')).toBe('var(--text-primary)');
    expect(colorValue('gold')).toContain('yellow');
    expect(colorValue('orange')).toBe('#FF9500');
    expect(colorValue('lime')).toBe('#9ACD32');
    for (const color of MAP_COLORS) expect(colorValue(color)).toBeTruthy();
  });

  it('makes a fresh id each time', () => {
    expect(newId()).not.toBe(newId());
  });
});

describe('editing a board', () => {
  const board: Board = {
    groups: [group('g')],
    cards: [card('a'), card('b', { groupId: 'g', x: 10, y: 20 })],
    arrows: [arrow('ab', 'a', 'b'), arrow('ag', 'a', 'g', { to: { cardId: null, groupId: 'g' } })],
  };

  it('names an end and finds the end of a node', () => {
    expect(endId({ cardId: 'a', groupId: null })).toBe('a');
    expect(endId({ cardId: null, groupId: 'g' })).toBe('g');
    expect(endOf(board, 'g')).toEqual({ cardId: null, groupId: 'g' });
    expect(endOf(board, 'a')).toEqual({ cardId: 'a', groupId: null });
  });

  it('places a grouped card from its group corner', () => {
    expect(absolutePosition(board, board.cards[1])).toEqual({ x: 110, y: 120 });
    expect(absolutePosition(board, board.cards[0])).toEqual({ x: 0, y: 0 });
  });

  it('adds Documents around the center in rows of four', () => {
    const documents = Array.from({ length: 5 }, (_, index) => ({
      id: `d${index}`,
      name: `D${index}`,
      subtitle: null,
      image: null,
      tagIds: [],
    }));
    const next = addDocumentCards(board, documents, { x: 0, y: 0 });
    const added = next.cards.slice(2);
    expect(added.map((c) => c.documentId)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
    expect(added[0].y).toBe(added[3].y);
    expect(added[4].y).toBeGreaterThan(added[0].y);
    expect(added[4].x).toBe(added[0].x);
    expect(added[0].document?.name).toBe('D0');
  });

  it('adds a text card at the center', () => {
    const [next, id] = addTextCard(
      board,
      {
        text: 'Idee',
        size: 'title',
        color: 'gold',
        struck: false,
        masterOnly: true,
      },
      { x: 500, y: 50 },
    );
    expect(next.cards.find((c) => c.id === id)).toMatchObject({
      text: 'Idee',
      size: 'title',
      masterOnly: true,
      y: 50,
    });
  });

  it('changes and removes cards with the arrows touching them', () => {
    expect(updateCard(board, 'a', { struck: true }).cards[0].struck).toBe(true);
    const next = removeCards(board, ['b']);
    expect(next.cards.map((c) => c.id)).toEqual(['a']);
    expect(next.arrows.map((a) => a.id)).toEqual(['ag']);
  });

  it('removes a group, keeping its cards where they stand', () => {
    const next = removeGroup(board, 'g');
    expect(next.groups).toEqual([]);
    expect(next.cards[1]).toMatchObject({ groupId: null, x: 110, y: 120 });
    expect(next.cards[0]).toBe(board.cards[0]);
    expect(next.arrows.map((a) => a.id)).toEqual(['ab']);
  });

  it('changes a group', () => {
    expect(updateGroup(board, 'g', { title: 'Corte' }).groups[0].title).toBe('Corte');
    expect(updateGroup(board, 'other', { title: 'x' }).groups[0].title).toBeNull();
  });

  it('frames cards in a new group with room for its title', () => {
    const [next, groupId] = groupCards(
      { ...board, cards: [...board.cards, card('c', { x: 999 })] },
      ['a', 'b'],
      { a: { width: 100, height: 50 } },
    );
    expect(next.cards.find((c) => c.id === 'c')?.x).toBe(999);
    const created = next.groups.find((g) => g.id === groupId)!;
    expect(created.x).toBe(-GROUP_PADDING);
    expect(created.width).toBe(110 + DEFAULT_CARD_SIZE.width + 2 * GROUP_PADDING);
    expect(created.y).toBeLessThan(-GROUP_PADDING);
    const moved = next.cards.find((c) => c.id === 'b')!;
    expect(moved.groupId).toBe(groupId);
    expect(moved.x + created.x).toBe(110);
    expect(groupCards(board, ['missing'], {})).toEqual([board, null]);
  });

  it('drops a card into the group under its center, or out of it', () => {
    const into = dropCard(board, 'a', { x: 150, y: 150 }, { width: 40, height: 40 });
    expect(into.cards[0]).toMatchObject({ groupId: 'g', x: 50, y: 50 });
    const out = dropCard(board, 'b', { x: 900, y: 900 }, { width: 40, height: 40 });
    expect(out.cards[1]).toMatchObject({ groupId: null, x: 900, y: 900 });
  });

  it('adds, changes and removes arrows', () => {
    const [next, id] = addArrow(board, { cardId: 'b', groupId: null }, { cardId: 'a', groupId: null });
    expect(next.arrows.find((a) => a.id === id)).toMatchObject({
      direction: 'forward',
      label: null,
    });
    expect(updateArrow(next, id, { label: 'padre di' }).arrows.find((a) => a.id === id)?.label).toBe('padre di');
    expect(removeArrow(next, id).arrows).toEqual(board.arrows);
  });
});

describe('drawing arrows', () => {
  it('joins two boxes edge to edge', () => {
    const { from, to } = arrowEnds(
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 300, y: 0, width: 100, height: 50 },
    );
    expect(from).toEqual({ x: 100, y: 25 });
    expect(to).toEqual({ x: 300, y: 25 });
  });

  it('leaves through the top or bottom when the other box is straight above or below', () => {
    const { from, to } = arrowEnds(
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 200, width: 100, height: 50 },
    );
    expect(from).toEqual({ x: 50, y: 50 });
    expect(to).toEqual({ x: 50, y: 200 });
  });

  it('stays at the center of two boxes on top of each other', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    expect(arrowEnds(box, box)).toEqual({
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
    });
  });

  it('finds a point along the line', () => {
    expect(pointAlong({ x: 0, y: 0 }, { x: 100, y: 40 }, 0.25)).toEqual({
      x: 25,
      y: 10,
    });
  });

  describe('labelSize', () => {
    it('grows with the text', () => {
      expect(labelSize('abc').width).toBeLessThan(labelSize('abcdefghij').width);
      expect(labelSize('abc').height).toBe(labelSize('abcdefghij').height);
    });
  });

  describe('placeLabel', () => {
    const size = { width: 100, height: 24 };
    const everywhere = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };
    const clear = (at: { x: number; y: number }, rects: { x: number; y: number; width: number; height: number }[]) =>
      rects.every(
        (r) => at.x + 50 <= r.x || at.x - 50 >= r.x + r.width || at.y + 12 <= r.y || at.y - 12 >= r.y + r.height,
      );

    it('keeps the wanted spot when no card is in the way', () => {
      expect(placeLabel({ x: 0, y: 0 }, { x: 400, y: 0 }, 0.5, size, [], everywhere)).toEqual({ x: 200, y: 0 });
    });

    it('slides the label along the arrow until the card no longer covers it', () => {
      const card = { x: 330, y: -50, width: 100, height: 100 };
      const at = placeLabel({ x: 0, y: 0 }, { x: 330, y: 0 }, 0.9, size, [card], everywhere);
      expect(at.x).toBeLessThan(330 - 50);
      expect(clear(at, [card])).toBe(true);
    });

    it('moves sideways, off the cards, when the line is too short to clear them', () => {
      const a = { x: 0, y: -50, width: 100, height: 100 };
      const b = { x: 110, y: 40, width: 100, height: 100 };
      const span = { x: 0, y: -50, width: 210, height: 190 };
      const at = placeLabel({ x: 100, y: -30 }, { x: 110, y: 10 }, 0.5, size, [a, b], span);
      expect(clear(at, [a, b])).toBe(true);
      expect(at.x).toBeGreaterThanOrEqual(span.x);
      expect(at.x).toBeLessThanOrEqual(span.x + span.width);
      expect(at.y).toBeGreaterThanOrEqual(span.y);
      expect(at.y).toBeLessThanOrEqual(span.y + span.height);
    });

    it('never throws the label past the cards to their far side', () => {
      // Two cards side by side with no gap: no spot between them is clear, so
      // the label stays at its wanted spot instead of jumping beyond them.
      const a = { x: 0, y: -50, width: 100, height: 100 };
      const b = { x: 110, y: -50, width: 100, height: 100 };
      const span = { x: 0, y: -50, width: 210, height: 100 };
      const at = placeLabel({ x: 100, y: 0 }, { x: 110, y: 0 }, 0.5, size, [a, b], span);
      expect(at).toEqual({ x: 105, y: 0 });
    });

    it('stays at the wanted spot when there is no room at all', () => {
      const wall = { x: -5000, y: -5000, width: 10000, height: 10000 };
      expect(placeLabel({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, size, [wall], everywhere)).toEqual({ x: 5, y: 0 });
    });
  });
});

describe('parallel lines between the same two ends', () => {
  const line = (id: string, from: string, to: string, direction: MapArrow['direction'] = 'none'): MapArrow => ({
    ...addArrow({ groups: [], cards: [], arrows: [] }, { cardId: from, groupId: null }, { cardId: to, groupId: null })[0].arrows[0],
    id,
    direction,
  });

  it('spreads plain lines side by side, centered, whichever way they were drawn', () => {
    const arrows = [line('1', 'a', 'b'), line('2', 'b', 'a'), line('3', 'a', 'b')];
    const shifts = arrows.map((arrow) => parallelShift(arrows, arrow));
    expect(shifts[0]).toBeCloseTo(-7);
    expect(shifts[1]).toBeCloseTo(0);
    expect(shifts[2]).toBeCloseTo(7);
  });

  it('leaves a lone line, arrows with heads and other pairs alone', () => {
    const arrows = [line('1', 'a', 'b'), line('2', 'a', 'c'), line('3', 'a', 'b', 'forward')];
    expect(arrows.map((arrow) => parallelShift(arrows, arrow))).toEqual([0, 0, 0]);
  });

  it('moves both ends to the side of the line', () => {
    const { from, to } = shiftParallel({ x: 0, y: 0 }, { x: 100, y: 0 }, 7);
    expect(from.x).toBeCloseTo(0);
    expect(from.y).toBeCloseTo(7);
    expect(to.x).toBeCloseTo(100);
    expect(to.y).toBeCloseTo(7);
  });

  it('does not move ends that sit on the same point', () => {
    expect(shiftParallel({ x: 5, y: 5 }, { x: 5, y: 5 }, 7)).toEqual({
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
    });
  });
});
