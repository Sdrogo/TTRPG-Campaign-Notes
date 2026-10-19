import { useState } from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeographicBoard } from '../../../components/maps/GeographicBoard';
import { toGeoMapDetail, type RawGeoMapDetail } from '../../../lib/geoMaps';
import type { Document } from '../../../types/document';
import type { GeoBoard, GeoLink } from '../../../types/geoMap';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

const map = toGeoMapDetail(rawGeoMapDetail() as unknown as RawGeoMapDetail);
const initial: GeoBoard = { areas: map.areas, pins: map.pins, links: map.links };
const documents = [{ id: 'doc-3', name: 'Elysium', subtitle: null, images: [], tagIds: [] }] as unknown as Document[];
const tags = [{ id: 'tag-1', name: 'Camarilla', category: null, mainPosition: null }];

// jsdom lays nothing out, so the board fits the plane (2000 × 1400) in its
// fallback 800 × 600 box: scale 0.38, shifted by (20, 34). `at` turns a plane
// point into the screen point a pointer event carries.
const K = 0.38;
function at(x: number, y: number) {
  return { clientX: 20 + x * K, clientY: 34 + y * K };
}

interface HarnessProps {
  board?: GeoBoard;
  editable?: boolean;
  isMaster?: boolean;
  backgroundUrl?: string | null;
  planeWidth?: number;
  onSelectDocument?: (documentId: string) => void;
}

const onChange = vi.fn();

function Harness({ board = initial, editable = true, isMaster = true, backgroundUrl = null, planeWidth = 2000, onSelectDocument }: HarnessProps) {
  const [current, setCurrent] = useState(board);
  return (
    <GeographicBoard
      roomId="room-1"
      board={current}
      planeWidth={planeWidth}
      planeHeight={1400}
      backgroundUrl={backgroundUrl}
      editable={editable}
      isMaster={isMaster}
      documents={documents}
      tags={tags}
      onChange={(next) => {
        onChange(next);
        setCurrent(next);
      }}
      onSelectDocument={onSelectDocument}
    />
  );
}

function render(props: HarnessProps = {}) {
  onChange.mockReset();
  const result = renderWithProviders(<Harness {...props} />);
  return { user: userEvent.setup(), ...result };
}

/** The board after "Modifica la mappa": it opens for reading (spec 38b). */
async function renderEditing(props: HarnessProps = {}) {
  const result = render(props);
  await result.user.click(screen.getByRole('button', { name: 'Modifica la mappa' }));
  return result;
}

function board() {
  return screen.getByRole('application', { name: 'Mappa geografica' });
}

/** A press and release at one plane point on `target`: a click. */
function tap(target: Element, x: number, y: number) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...at(x, y) });
  fireEvent.pointerUp(board(), { pointerId: 1, ...at(x, y) });
}

/** A press on `target` dragged from one plane point to another. */
function drag(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...at(...from) });
  fireEvent.pointerMove(board(), { pointerId: 1, ...at(from[0] + (to[0] - from[0]) / 2, from[1] + (to[1] - from[1]) / 2) });
  fireEvent.pointerMove(board(), { pointerId: 1, ...at(...to) });
  fireEvent.pointerUp(board(), { pointerId: 1, ...at(...to) });
}

function lastBoard(): GeoBoard {
  return onChange.mock.lastCall![0] as GeoBoard;
}

function plane() {
  return board().querySelector('rect')!;
}

function viewTransform() {
  return board().querySelector('g')!.getAttribute('transform');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeographicBoard: what it draws (spec 38)', () => {
  it('draws the areas, pins and links with their names', () => {
    render({ editable: false });
    expect(screen.getByRole('button', { name: 'Incrocio' }).tagName).toBe('polygon');
    expect(screen.getByRole('button', { name: 'Il bosco' })).toHaveAttribute('fill-opacity', '0');
    expect(screen.getByRole('button', { name: 'Il bosco' })).toHaveAttribute('stroke-dasharray');
    expect(screen.getByText('Il cuore')).toBeInTheDocument();
    // A Document's pin is a diamond, a plain one a circle.
    expect(screen.getByRole('button', { name: 'Shibuya Sky' }).querySelector('polygon')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Shibuya 109' }).querySelector('circle')).not.toBeNull();
    // A Master-only place is drawn faded for the Master.
    expect(screen.getByRole('button', { name: 'Shibuya 109' })).toHaveAttribute('opacity', '0.65');
    expect(screen.getByRole('button', { name: 'Collegamento da Shibuya Sky a Shibuya 109' })).toBeInTheDocument();
    expect(screen.getByText('la finestra')).toBeInTheDocument();
    // Read-only: no tools.
    expect(screen.queryByRole('radio', { name: 'Area' })).not.toBeInTheDocument();
    expect(board().querySelector('image')).toBeNull();
  });

  it('stretches the background over the plane', () => {
    render({ backgroundUrl: 'https://cdn/bg.webp' });
    const image = board().querySelector('image')!;
    expect(image).toHaveAttribute('href', 'https://cdn/bg.webp');
    expect(image).toHaveAttribute('width', '2000');
    expect(image).toHaveAttribute('preserveAspectRatio', 'none');
  });

  it('writes a pin name on each side, and every kind of link', () => {
    const link = (overrides: Partial<GeoLink>): GeoLink => ({ ...map.links[0], ...overrides });
    render({
      board: {
        areas: map.areas,
        pins: [
          ...map.pins,
          { ...map.pins[1], id: 'p-right', name: 'Destra', labelSide: 'right', masterOnly: false },
          { ...map.pins[1], id: 'p-below', name: 'Sotto', labelSide: 'below', masterOnly: false },
        ],
        links: [
          link({ id: 'two-way', direction: 'both', label: 'protegge', reverseLabel: 'serve', masterOnly: true }),
          link({ id: 'one-label', direction: 'both', label: 'solo andata', reverseLabel: null, from: { areaId: 'area-1', pinId: null } }),
          link({ id: 'reverse-only', direction: 'both', label: null, reverseLabel: 'solo ritorno', from: { areaId: 'area-2', pinId: null } }),
          link({ id: 'line', direction: 'none', label: null }),
          link({ id: 'placed', label: 'spostata', labelPosition: 0.3, labelOffset: 20, bend: null }),
          // A link whose end isn't on the map is not drawn.
          link({ id: 'dangling', label: 'persa', to: { areaId: null, pinId: 'gone' } }),
        ],
      },
    });
    for (const [name, anchor] of [
      ['Shibuya Sky', 'end'],
      ['Shibuya 109', 'middle'],
      ['Destra', 'start'],
      ['Sotto', 'middle'],
    ]) {
      expect(screen.getByText(name, { selector: 'text' })).toHaveAttribute('text-anchor', anchor);
    }
    expect(screen.getByText('protegge')).toBeInTheDocument();
    expect(screen.getByText('serve')).toBeInTheDocument();
    expect(screen.getByText('solo andata')).toBeInTheDocument();
    expect(screen.getByText('solo ritorno')).toBeInTheDocument();
    expect(screen.getByText('spostata')).toBeInTheDocument();
    expect(screen.queryByText('persa')).not.toBeInTheDocument();
    // Two arrowheads on the two-way links, none on a line, one on the others.
    expect(board().querySelectorAll('g[opacity]:not([role]) > polygon')).toHaveLength(2 + 2 + 2 + 0 + 1);
  });

  it('dims what lacks the filtered Tag (Decision 8)', async () => {
    const { user } = render({ editable: false });
    await user.click(screen.getByRole('combobox', { name: 'Filtra per Tag' }));
    await user.click(await screen.findByRole('option', { name: 'Camarilla' }));
    expect(screen.getByRole('button', { name: 'Incrocio' })).toHaveAttribute('opacity', '1');
    expect(screen.getByRole('button', { name: 'Shibuya Sky' })).toHaveAttribute('opacity', '0.2');
    await user.click(screen.getByLabelText('Togli il filtro'));
    expect(screen.getByRole('button', { name: 'Shibuya Sky' })).toHaveAttribute('opacity', '1');
  });
});

describe('GeographicBoard: moving around', () => {
  it('pans with a drag on the plane, and zooms with the wheel and the buttons', async () => {
    const { user } = render({ editable: false });
    expect(viewTransform()).toBe('translate(20 34) scale(0.38)');
    // A press that barely moves is not a pan.
    fireEvent.pointerDown(plane(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 102, clientY: 101 });
    expect(viewTransform()).toBe('translate(20 34) scale(0.38)');
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 150, clientY: 130 });
    fireEvent.pointerUp(board(), { pointerId: 1, clientX: 150, clientY: 130 });
    expect(viewTransform()).toBe('translate(70 64) scale(0.38)');
    // A move with no press does nothing.
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 300, clientY: 300 });
    expect(viewTransform()).toBe('translate(70 64) scale(0.38)');

    fireEvent.wheel(board(), { deltaY: -200, clientX: 70, clientY: 64 });
    expect(viewTransform()).toMatch(/^translate\(70 64\) scale\(0\.5/);
    await user.click(screen.getByRole('button', { name: 'Mostra tutta la mappa' }));
    expect(viewTransform()).toBe('translate(20 34) scale(0.38)');
    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));
    expect(viewTransform()).toMatch(/scale\(0\.475\)/);
    await user.click(screen.getByRole('button', { name: 'Rimpicciolisci' }));
    expect(viewTransform()).toMatch(/scale\(0\.38\)/);
  });

  it('ignores a press with another button, and a cancelled one', () => {
    render();
    fireEvent.pointerDown(plane(), { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 200, clientY: 200 });
    expect(viewTransform()).toBe('translate(20 34) scale(0.38)');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Shibuya Sky' }), { button: 0, pointerId: 1, ...at(300, 250) });
    fireEvent.pointerMove(board(), { pointerId: 1, ...at(600, 600) });
    fireEvent.pointerCancel(board(), { pointerId: 1 });
    fireEvent.pointerUp(board(), { pointerId: 1, ...at(600, 600) });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows the size of its box, and shows the whole plane again when it changes size', () => {
    // Mantine observes elements too: only the board's box is reported.
    const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { callback: ResizeObserverCallback; targets: Element[] };
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback, targets: [] };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { rerender } = render();
    const box = board().parentElement!;
    const report = (width: number, height: number) =>
      act(() =>
        observers
          .filter((observer) => observer.targets.includes(box))
          .forEach((observer) =>
            observer.callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver),
          ),
      );
    report(0, 0);
    expect(viewTransform()).toBe('translate(20 34) scale(0.38)');
    report(400, 300);
    expect(viewTransform()).toBe('translate(10 17) scale(0.19)');
    fireEvent.wheel(board(), { deltaY: 100, clientX: 0, clientY: 0 });
    expect(viewTransform()).not.toBe('translate(10 17) scale(0.19)');
    rerender(<Harness planeWidth={1000} />);
    // 1000 × 1400 in 400 × 300: the height decides, centered across.
    expect(viewTransform()).toMatch(/^translate\(98\.21\d* 7\.5\d*\) scale\(0\.2035/);
  });
});

describe('GeographicBoard: looking at a place', () => {
  it("shows a place's card, with its Document and note, and closes it", async () => {
    const { user } = render({ editable: false });
    tap(screen.getByRole('button', { name: 'Incrocio' }), 300, 150);
    const card = screen.getByText('Incrocio', { selector: 'p' }).closest('.mantine-Paper-root') as HTMLElement;
    expect(within(card).getByText('Il cuore')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Apri il Documento' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-1');
    expect(within(card).queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incrocio' })).toHaveAttribute('aria-pressed', 'true');

    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    expect(screen.getByText('Il cilindro argentato.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Apri il Documento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByText('Il cilindro argentato.')).not.toBeInTheDocument();

    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    expect(screen.getByText('Nessuno lo controlla.')).toBeInTheDocument();
    // A click on the empty plane lets it go.
    tap(plane(), 1800, 1300);
    expect(screen.queryByText('Nessuno lo controlla.')).not.toBeInTheDocument();
  });

  it('shows a Document in the split pane when it is open (spec 37)', () => {
    const onSelectDocument = vi.fn();
    render({ editable: false, onSelectDocument });
    tap(screen.getByRole('button', { name: 'Shibuya Sky' }), 300, 250);
    expect(onSelectDocument).toHaveBeenCalledWith('doc-2');
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    expect(onSelectDocument).toHaveBeenCalledTimes(1);
  });

  it('opens a Document place beside the map, and keeps the card for the others (spec 38b)', async () => {
    const onSelectDocument = vi.fn();
    const { user } = render({ onSelectDocument });
    tap(screen.getByRole('button', { name: 'Incrocio' }), 300, 150);
    expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
    expect(screen.queryByText('Il cuore', { selector: 'p' })).not.toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    expect(screen.getByText('Il cilindro argentato.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();

    // While editing, a Document place still opens beside the map, and its card edits it.
    await user.click(screen.getByRole('button', { name: 'Modifica la mappa' }));
    tap(screen.getByRole('button', { name: 'Incrocio' }), 300, 150);
    expect(onSelectDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Il cuore', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Apri il Documento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifica' })).toBeInTheDocument();
  });

  it('opens for reading, and edits only after "Modifica la mappa" (spec 38b)', async () => {
    const { user } = render();
    expect(screen.queryByRole('radiogroup', { name: 'Strumento' })).not.toBeInTheDocument();
    // Reading: no dragging, no link dialog, no Delete.
    drag(screen.getByRole('button', { name: 'Shibuya 109' }), [800, 700], [900, 800]);
    fireEvent.click(screen.getByText('la finestra'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    board().focus();
    await user.keyboard('{Delete}');
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Modifica la mappa' }));
    expect(screen.queryByRole('button', { name: 'Modifica la mappa' })).not.toBeInTheDocument();
    expect(screen.queryByText('Il cilindro argentato.')).not.toBeInTheDocument();
    await user.click(screen.getByText('Luogo'));
    await user.click(screen.getByRole('button', { name: 'Fine modifiche' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Seleziona')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifica la mappa' })).toBeInTheDocument();
  });

  it('a click on a link opens nothing on a read-only map', () => {
    render({ editable: false });
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Collegamento/ }), { button: 0, pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: /^Collegamento/ }));
    fireEvent.click(screen.getByText('la finestra'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GeographicBoard: editing (Decision 9)', () => {
  it('draws an area corner by corner and names it', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('Area'));
    expect(screen.getByRole('status')).toHaveTextContent('Clicca sul piano per aggiungere un angolo');
    tap(plane(), 1500, 900);
    // A click on a place while drawing lands on the plane.
    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 1800, 900);
    tap(plane(), 1800, 1200);
    tap(plane(), 1600, 1300);
    await user.click(screen.getByRole('button', { name: "Togli l'ultimo angolo" }));
    // Back on the first corner closes the shape.
    tap(plane(), 1502, 901);
    const dialog = await screen.findByRole('dialog', { name: 'Nuova area' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Nome/ }), 'Harajuku');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    const added = lastBoard().areas.at(-1)!;
    expect(added).toMatchObject({
      name: 'Harajuku',
      points: [
        [1500, 900],
        [1800, 900],
        [1800, 1200],
      ],
    });
    // The new area is selected, with handles for its corners.
    expect(screen.getAllByRole('button', { name: /^Angolo/ })).toHaveLength(3);
  });

  it('closes an area with its button, or drops it on cancel', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('Area'));
    tap(plane(), 1500, 900);
    tap(plane(), 1800, 900);
    expect(screen.getByRole('button', { name: "Chiudi l'area" })).toBeDisabled();
    tap(plane(), 1800, 1200);
    await user.click(screen.getByRole('button', { name: "Chiudi l'area" }));
    await screen.findByRole('dialog', { name: 'Nuova area' });
    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByText('Area'));
    tap(plane(), 100, 900);
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('places a pin where the plane is clicked', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('Luogo'));
    expect(screen.getByRole('status')).toHaveTextContent('aggiungere un luogo');
    tap(plane(), 1000, 1000);
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo luogo' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Nome/ }), 'Fontana');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(lastBoard().pins.at(-1)).toMatchObject({ name: 'Fontana', x: 1000, y: 1000 });
  });

  it('links two places and edits the link', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('Collegamento'));
    expect(screen.getByRole('status')).toHaveTextContent('Clicca il primo luogo');
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    expect(screen.getByRole('status')).toHaveTextContent('collegamento da Il bosco');
    // The same place again is not a link; the empty plane drops the first end.
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    expect(onChange).not.toHaveBeenCalled();
    tap(plane(), 1800, 1300);
    expect(screen.getByRole('status')).toHaveTextContent('Clicca il primo luogo');
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    tap(screen.getByRole('button', { name: 'Incrocio' }), 300, 150);
    expect(lastBoard().links.at(-1)).toMatchObject({ from: { areaId: 'area-2' }, to: { areaId: 'area-1' } });
    const dialog = await screen.findByRole('dialog', { name: 'Relazione' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Etichetta' }), 'sorveglia');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(lastBoard().links.at(-1)?.label).toBe('sorveglia');
  });

  it('opens a link by its line or label, then deletes it', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('la finestra'));
    await screen.findByRole('dialog', { name: 'Relazione' });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Collegamento/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Relazione' })).getByRole('button', { name: 'Elimina la relazione' }));
    expect(lastBoard().links).toHaveLength(0);
  });

  it("drags a link's curve, and a double click straightens it back to the default", async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByRole('button', { name: /^Collegamento/ }));
    await user.keyboard('{Escape}');
    const handle = screen.getByRole('button', { name: 'Curvatura del collegamento' });
    drag(handle, [550, 475], [700, 300]);
    expect(lastBoard().links[0].bend).not.toBe(-80);
    // A still press on the handle changes nothing.
    const calls = onChange.mock.calls.length;
    tap(screen.getByRole('button', { name: 'Curvatura del collegamento' }), 600, 300);
    expect(onChange).toHaveBeenCalledTimes(calls);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Curvatura del collegamento' }));
    expect(lastBoard().links[0].bend).toBeNull();
  });

  it('drags pins and areas, kept inside the plane', async () => {
    await renderEditing();
    drag(screen.getByRole('button', { name: 'Shibuya Sky' }), [300, 250], [-500, 260]);
    expect(lastBoard().pins[0]).toMatchObject({ x: 0, y: 260 });
    drag(screen.getByRole('button', { name: 'Il bosco' }), [1200, 200], [1300, 150]);
    expect(lastBoard().areas[1].points[0]).toEqual([1100, 50]);
  });

  it("moves, adds and removes an area's corners", async () => {
    await renderEditing();
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    drag(screen.getByRole('button', { name: 'Angolo 1' }), [1000, 100], [950, 80]);
    expect(lastBoard().areas[1].points[0]).toEqual([950, 80]);
    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'Aggiungi un angolo' })[0], { button: 0, pointerId: 1 });
    expect(lastBoard().areas[1].points).toHaveLength(4);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Angolo 2' }));
    expect(lastBoard().areas[1].points).toHaveLength(3);
  });

  it('edits and deletes a place from its card', async () => {
    const { user } = await renderEditing();
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    await user.click(screen.getByRole('button', { name: 'Modifica' }));
    let dialog = await screen.findByRole('dialog', { name: "Modifica l'area" });
    await user.clear(within(dialog).getByRole('textbox', { name: /^Nome/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /^Nome/ }), 'Yoyogi');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(lastBoard().areas[1].name).toBe('Yoyogi');
    await user.click(screen.getByRole('button', { name: 'Modifica' }));
    dialog = await screen.findByRole('dialog', { name: "Modifica l'area" });
    await user.click(within(dialog).getByRole('button', { name: "Elimina l'area" }));
    expect(lastBoard().areas.map((area) => area.id)).toEqual(['area-1']);

    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    await user.click(screen.getByRole('button', { name: 'Modifica' }));
    dialog = await screen.findByRole('dialog', { name: 'Modifica il luogo' });
    await user.click(within(dialog).getByText('Sotto'));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(lastBoard().pins[1].labelSide).toBe('below');
    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    await user.click(screen.getByRole('button', { name: 'Modifica' }));
    dialog = await screen.findByRole('dialog', { name: 'Modifica il luogo' });
    await user.click(within(dialog).getByRole('button', { name: 'Elimina il luogo' }));
    // The link touching it goes with it.
    expect(lastBoard().pins).toHaveLength(1);
    expect(lastBoard().links).toHaveLength(0);
  });

  it('removes what is selected with Delete, and Escape puts the tools away', async () => {
    const { user } = await renderEditing();
    board().focus();
    await user.keyboard('{Delete}');
    expect(onChange).not.toHaveBeenCalled();
    tap(screen.getByRole('button', { name: 'Shibuya 109' }), 800, 700);
    board().focus();
    await user.keyboard('{Delete}');
    expect(lastBoard().pins.map((pin) => pin.id)).toEqual(['pin-1']);

    await user.click(screen.getByText('Luogo'));
    board().focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('removes a selected link with Backspace', async () => {
    const { user } = await renderEditing();
    await user.click(screen.getByText('la finestra'));
    await user.keyboard('{Escape}');
    board().focus();
    await user.keyboard('{Backspace}');
    expect(lastBoard().links).toHaveLength(0);
  });
});
