import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GeographicBoard } from '../../../components/maps/GeographicBoard';
import { toGeoMapDetail, type RawGeoMapDetail } from '../../../lib/geoMaps';
import type { Document } from '../../../types/document';
import type { AreaLabels, GeoArea, GeoBoard } from '../../../types/geoMap';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

// Spec 77: a Document with several areas on a geographic map.
const map = toGeoMapDetail(rawGeoMapDetail() as unknown as RawGeoMapDetail);
const [crossing, wood] = map.areas;
const patch: GeoArea = {
  ...crossing,
  id: 'area-3',
  points: [
    [100, 800],
    [250, 800],
    [250, 950],
    [100, 950],
  ],
};
const initial: GeoBoard = { areas: [crossing, wood, patch], pins: map.pins, links: [] };
const documents = [
  { id: 'doc-1', name: 'Incrocio', subtitle: 'Il cuore', images: [], tagIds: [] },
  { id: 'doc-2', name: 'Shibuya Sky', subtitle: null, images: [], tagIds: [] },
  { id: 'doc-3', name: 'Elysium', subtitle: null, images: [], tagIds: [] },
] as unknown as Document[];

const K = 0.38;
function at(x: number, y: number) {
  return { clientX: 20 + x * K, clientY: 34 + y * K };
}

const onChange = vi.fn();

function Harness({ board = initial, areaLabels = null }: { board?: GeoBoard; areaLabels?: AreaLabels | null }) {
  const [current, setCurrent] = useState(board);
  return (
    <GeographicBoard
      roomId="room-1"
      board={current}
      planeWidth={2000}
      planeHeight={1400}
      backgroundUrl={null}
      editable
      isMaster
      documents={documents}
      tags={[]}
      areaLabels={areaLabels}
      onChange={(next) => {
        onChange(next);
        setCurrent(next);
      }}
    />
  );
}

function render(props: { board?: GeoBoard; areaLabels?: AreaLabels | null } = {}) {
  onChange.mockReset();
  renderWithProviders(<Harness {...props} />);
  return userEvent.setup();
}

function svg() {
  return screen.getByRole('application', { name: 'Mappa geografica' });
}

function tap(target: Element, x: number, y: number) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, ...at(x, y) });
  fireEvent.pointerUp(svg(), { pointerId: 1, ...at(x, y) });
}

function lastBoard(): GeoBoard {
  return onChange.mock.lastCall![0] as GeoBoard;
}

describe('GeographicBoard: a Document with several areas (spec 77)', () => {
  it("outlines all of a Document's areas and says which one is selected", () => {
    render();
    const [first] = screen.getAllByRole('button', { name: 'Incrocio' });
    tap(first, 300, 200);
    expect(svg().querySelectorAll('[data-testid="area-halo"]')).toHaveLength(2);
    expect(screen.getByText('Area 1 di 2 di questo Documento')).toBeInTheDocument();
    tap(svg().querySelector('rect')!, 1800, 1300);
    expect(svg().querySelectorAll('[data-testid="area-halo"]')).toHaveLength(0);
  });

  it('names every area, or only the largest one of a Document', () => {
    const { unmount } = renderWithProviders(<Harness />);
    expect(screen.getAllByText('Incrocio', { selector: 'text' })).toHaveLength(2);
    unmount();
    render({ areaLabels: 'largest' });
    expect(screen.getAllByText('Incrocio', { selector: 'text' })).toHaveLength(1);
    // The unnamed patch keeps its name as a tooltip.
    expect(screen.getByText('Incrocio', { selector: 'title' })).toBeInTheDocument();
    // Plain areas keep their name.
    expect(screen.getByText('Il bosco', { selector: 'text' })).toBeInTheDocument();
  });

  it('adds an area to the same Document in its color, and recolors them all together', async () => {
    const user = render();
    await user.click(screen.getByRole('button', { name: 'Modifica la mappa' }));
    tap(screen.getAllByRole('button', { name: 'Incrocio' })[0], 300, 200);
    await user.click(screen.getByRole('button', { name: "Aggiungi un'area" }));
    tap(svg().querySelector('rect')!, 1500, 900);
    tap(svg().querySelector('rect')!, 1800, 900);
    tap(svg().querySelector('rect')!, 1800, 1200);
    tap(svg().querySelector('rect')!, 1502, 901);
    const dialog = await screen.findByRole('dialog', { name: 'Nuova area' });
    expect(within(dialog).getByText('Il colore vale per tutte le 3 aree di questo Documento.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Rosso' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    const saved = lastBoard().areas.filter((area) => area.documentId === 'doc-1');
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((area) => area.color))).toEqual(new Set(['red']));
  });

  it('binds an existing plain area to a Document that has areas, taking their color', async () => {
    const user = render();
    await user.click(screen.getByRole('button', { name: 'Modifica la mappa' }));
    tap(screen.getByRole('button', { name: 'Il bosco' }), 1200, 200);
    await user.click(screen.getByRole('button', { name: 'Modifica' }));
    const dialog = await screen.findByRole('dialog', { name: "Modifica l'area" });
    await user.click(within(dialog).getByRole('combobox', { name: /^Documento/ }));
    // A Document placed as a pin isn't offered for an area; one with areas is, marked.
    expect(screen.queryByRole('option', { name: 'Shibuya Sky' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Incrocio (già sulla mappa)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    const rebound = lastBoard().areas.find((area) => area.id === 'area-2')!;
    expect(rebound).toMatchObject({ documentId: 'doc-1', color: 'blue' });
  });
});
