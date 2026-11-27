import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GeographicBoard } from '../../../components/maps/GeographicBoard';
import { toGeoMapDetail, type RawGeoMapDetail } from '../../../lib/geoMaps';
import type { GeoBoard } from '../../../types/geoMap';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

// Spec 77b: the area color legend on a geographic map.
const map = toGeoMapDetail(rawGeoMapDetail() as unknown as RawGeoMapDetail);
const [first, second] = map.areas;
const board: GeoBoard = {
  areas: [
    { ...first, color: 'red' },
    { ...second, color: 'blue' },
  ],
  pins: [],
  links: [],
};

function render(onEdit?: () => void) {
  renderWithProviders(
    <GeographicBoard
      roomId="room-1"
      board={board}
      planeWidth={2000}
      planeHeight={1400}
      backgroundUrl={null}
      editable={false}
      isMaster={false}
      documents={[]}
      tags={[]}
      onChange={vi.fn()}
      legend={{ mapId: 'map-geo', meanings: { red: 'Yakuza', blue: 'Polizia', gold: 'Nessuno' }, presetName: null, onEdit }}
    />,
  );
  return userEvent.setup();
}

const area = (index: number) => screen.getAllByRole('button', { pressed: false }).filter((el) => el.tagName === 'polygon')[index];

describe('GeographicBoard: area legend (spec 77b)', () => {
  it('lists the colors the areas use and fades the others while a row is on', async () => {
    const user = render();
    expect(screen.getByText('Legenda aree')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Rosso: Yakuza', 'Azzurro: Polizia']);
    expect(area(0)).toHaveAttribute('opacity', '1');
    expect(area(1)).toHaveAttribute('opacity', '1');

    await user.click(rows[0]);
    expect(area(0)).toHaveAttribute('opacity', '1');
    expect(area(1)).toHaveAttribute('opacity', '0.2');
    expect(screen.getByText(/premi Esc per vedere tutte le aree/)).toBeInTheDocument();

    // Another key leaves it on; Esc clears it.
    await user.keyboard('a');
    expect(area(1)).toHaveAttribute('opacity', '0.2');
    await user.keyboard('{Escape}');
    expect(area(1)).toHaveAttribute('opacity', '1');
  });
});
