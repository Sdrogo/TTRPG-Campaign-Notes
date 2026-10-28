import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaceSidePane } from '../../../components/maps/PlaceSidePane';
import { toGeoMapDetail, type RawGeoMapDetail } from '../../../lib/geoMaps';
import type { GeoBoard } from '../../../types/geoMap';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

const map = toGeoMapDetail(rawGeoMapDetail() as unknown as RawGeoMapDetail);
const board: GeoBoard = { areas: map.areas, pins: map.pins, links: map.links };

function render(place: { kind: 'area' | 'pin'; id: string }, onBoard: GeoBoard = board) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<PlaceSidePane board={onBoard} place={place} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose, user: userEvent.setup() };
}

describe('PlaceSidePane (spec 50)', () => {
  it("shows a pin's name, note and links, and opens a linked place", async () => {
    const { onPick, onClose, user } = render({ kind: 'pin', id: 'pin-2' });
    expect(screen.getByRole('complementary', { name: 'Luogo aperto accanto alla mappa' })).toBeInTheDocument();
    expect(screen.getByText('Shibuya 109')).toBeInTheDocument();
    expect(screen.getByText('Il cilindro argentato.')).toBeInTheDocument();
    expect(screen.getByText('Collegamenti')).toBeInTheDocument();
    // The link comes in from Shibuya Sky (a Document's pin) with no reverse label.
    await user.click(screen.getByRole('button', { name: /Shibuya Sky/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-2' }), { kind: 'pin', id: 'pin-1' });
    await user.click(screen.getByRole('button', { name: 'Chiudi il pannello' }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an area's subtitle, and says when there is no note", () => {
    render({ kind: 'area', id: 'area-2' }, {
      ...board,
      areas: board.areas.map((area) => (area.id === 'area-2' ? { ...area, note: null } : area)),
    });
    expect(screen.getByText('Il bosco')).toBeInTheDocument();
    expect(screen.getByText('Sacro')).toBeInTheDocument();
    expect(screen.getByText('Nessuna nota')).toBeInTheDocument();
    expect(screen.queryByText('Collegamenti')).not.toBeInTheDocument();
  });

  it('reads the note as Markdown', () => {
    render({ kind: 'pin', id: 'pin-2' }, {
      ...board,
      pins: board.pins.map((pin) => (pin.id === 'pin-2' ? { ...pin, note: 'Un **grande** schermo' } : pin)),
    });
    expect(screen.getByText('grande').tagName).toBe('STRONG');
  });

  it('says when the place is gone, and still closes', async () => {
    const { onClose, user } = render({ kind: 'pin', id: 'pin-9' });
    expect(screen.getByText('Luogo non trovato')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi il pannello' }));
    expect(onClose).toHaveBeenCalled();
  });
});
