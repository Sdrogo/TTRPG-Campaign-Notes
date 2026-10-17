import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaDialog } from '../../../components/maps/AreaDialog';
import { GeoMapDialog } from '../../../components/maps/GeoMapDialog';
import { PinDialog } from '../../../components/maps/PinDialog';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { newArea, newPin, toGeoMapDetail, type RawGeoMapDetail } from '../../../lib/geoMaps';
import type { Document } from '../../../types/document';
import type { GeoArea, GeoPin } from '../../../types/geoMap';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

const documents = [
  { id: 'doc-1', name: 'Incrocio', subtitle: 'Il cuore', images: [], tagIds: ['tag-1'] },
  { id: 'doc-2', name: 'Shibuya Sky', subtitle: null, images: [], tagIds: [] },
  { id: 'doc-3', name: 'Elysium', subtitle: null, images: [], tagIds: [] },
] as unknown as Document[];

const map = toGeoMapDetail(rawGeoMapDetail() as unknown as RawGeoMapDetail);
const square: GeoArea['points'] = [
  [0, 0],
  [10, 0],
  [10, 10],
];

beforeEach(() => {
  fetchMock.mockReset();
});

describe('AreaDialog', () => {
  it('names a new plain area, with its subtitle, note, look and Master only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <AreaDialog
        area={newArea(square)}
        isNew
        documents={documents}
        takenDocumentIds={new Set(['doc-2'])}
        isMaster
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nuova area' })).toBeInTheDocument();
    // Nothing to delete yet, and no name means nothing to save.
    expect(screen.queryByRole('button', { name: "Elimina l'area" })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), ' Il bosco ');
    await user.type(screen.getByRole('textbox', { name: 'Sottotitolo' }), 'Sacro');
    await user.type(screen.getByRole('textbox', { name: 'Nota' }), 'Nessuno lo controlla.');
    await user.click(screen.getByRole('radio', { name: 'Verde' }));
    await user.click(screen.getByRole('checkbox', { name: 'Riempita' }));
    await user.click(screen.getByRole('checkbox', { name: /tratteggiato/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Visibile solo ai Master' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: null,
        name: 'Il bosco',
        subtitle: 'Sacro',
        note: 'Nessuno lo controlla.',
        color: 'green',
        filled: false,
        dashed: true,
        masterOnly: true,
        document: null,
      }),
    );
  });

  it("binds an area to a Document not yet on the map, dropping its own texts", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <AreaDialog
        area={{ ...map.areas[1], masterOnly: true }}
        isNew={false}
        documents={documents}
        takenDocumentIds={new Set(['doc-1', 'doc-2'])}
        isMaster
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: "Modifica l'area" })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /^Documento/ }));
    // A Document is on a map once (Decision 4): those placed aren't offered.
    expect(screen.queryByRole('option', { name: 'Incrocio' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Elysium' }));
    expect(screen.queryByRole('textbox', { name: 'Sottotitolo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Visibile solo ai Master' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-3',
        name: null,
        subtitle: null,
        note: null,
        masterOnly: false,
        document: expect.objectContaining({ id: 'doc-3', name: 'Elysium' }),
      }),
    );
  });

  it("keeps a bound Document's look while the Room's Documents haven't loaded, and deletes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    renderWithProviders(
      <AreaDialog
        area={map.areas[0]}
        isNew={false}
        documents={[]}
        takenDocumentIds={new Set(['doc-1'])}
        isMaster={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-1', document: map.areas[0].document }));
    await user.click(screen.getByRole('button', { name: "Elimina l'area" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('turns a bound area plain, and offers no Master only to a Player', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <AreaDialog
        area={map.areas[0]}
        isNew={false}
        documents={documents}
        takenDocumentIds={new Set(['doc-1'])}
        isMaster={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Mantine hides the clear button from assistive tech (Backspace clears too).
    await user.click(screen.getByLabelText('Togli il Documento'));
    expect(screen.getByRole('textbox', { name: /^Nome/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Visibile solo ai Master' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Incrocio libero');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: null, name: 'Incrocio libero', subtitle: null, note: null, document: null }),
    );
  });
});

describe('PinDialog', () => {
  it('names a new plain pin, with its note, side, color and Master only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <PinDialog
        pin={newPin({ x: 10, y: 20 })}
        isNew
        documents={documents}
        takenDocumentIds={new Set()}
        isMaster
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nuovo luogo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Elimina il luogo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Shibuya 109');
    await user.type(screen.getByRole('textbox', { name: 'Nota' }), 'Il cilindro.');
    await user.click(screen.getByText('Sopra'));
    await user.click(screen.getByRole('radio', { name: 'Giallo' }));
    await user.click(screen.getByRole('checkbox', { name: 'Visibile solo ai Master' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 10,
        y: 20,
        name: 'Shibuya 109',
        note: 'Il cilindro.',
        labelSide: 'above',
        color: 'gold',
        masterOnly: true,
        document: null,
      }),
    );
  });

  it('saves a plain pin with no note', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <PinDialog
        pin={newPin({ x: 1, y: 2 })}
        isNew
        documents={[]}
        takenDocumentIds={new Set()}
        isMaster={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Fontana');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fontana', note: null, masterOnly: false }));
  });

  it('binds a pin to a Document, keeps its look before the list loads, and deletes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const pin: GeoPin = map.pins[1];
    const { unmount } = renderWithProviders(
      <PinDialog
        pin={pin}
        isNew={false}
        documents={documents}
        takenDocumentIds={new Set(['doc-2'])}
        isMaster={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Modifica il luogo' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /^Documento/ }));
    await user.click(await screen.findByRole('option', { name: 'Elysium' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-3', name: null, note: null, masterOnly: false, document: expect.objectContaining({ name: 'Elysium' }) }),
    );
    await user.click(screen.getByRole('button', { name: 'Elimina il luogo' }));
    expect(onDelete).toHaveBeenCalled();
    unmount();

    renderWithProviders(
      <PinDialog
        pin={map.pins[0]}
        isNew={false}
        documents={[]}
        takenDocumentIds={new Set(['doc-2'])}
        isMaster
        onSave={onSave}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ documentId: 'doc-2', document: map.pins[0].document }));
  });
});

describe('GeoMapDialog', () => {
  function render(overrides: Partial<typeof map> = {}) {
    const onClose = vi.fn();
    renderWithProviders(<GeoMapDialog roomId="room-1" map={{ ...map, ...overrides }} onClose={onClose} />);
    return { user: userEvent.setup(), onClose };
  }

  it("resizes the plane within the limits, and says why it was refused", async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(422, "Un'area resterebbe fuori dal piano"));
    const { user } = render();
    const save = screen.getByRole('button', { name: 'Salva le dimensioni' });
    expect(save).toBeDisabled();
    const width = screen.getByRole('textbox', { name: 'Larghezza' });
    await user.clear(width);
    await user.type(width, '50');
    expect(save).toBeDisabled();
    await user.clear(width);
    expect(save).toBeDisabled();
    await user.type(width, '1000');
    await user.click(save);
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1', {
      method: 'PATCH',
      json: { plane_width: 1000, plane_height: 1400 },
    });
    expect(await screen.findByText("Un'area resterebbe fuori dal piano")).toBeInTheDocument();
    const height = screen.getByRole('textbox', { name: 'Altezza' });
    await user.clear(height);
    await user.type(height, '900');
    fetchMock.mockResolvedValueOnce(rawGeoMapDetail());
    await user.click(save);
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/maps/map-1', {
      method: 'PATCH',
      json: { plane_width: 1000, plane_height: 900 },
    });
  });

  it('uploads a background, or takes one from a URL', async () => {
    fetchMock.mockResolvedValue(rawGeoMapDetail({ background_url: 'https://cdn/bg.webp' }));
    const { user } = render();
    expect(screen.getByText('Nessuno sfondo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rimuovi lo sfondo' })).not.toBeInTheDocument();
    const file = new File(['png'], 'shibuya.png', { type: 'image/png' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/maps/map-1/background',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Da un URL' }));
    await user.type(await screen.findByRole('textbox', { name: /URL/ }), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/background/from-url', {
        method: 'POST',
        json: { url: 'https://example.com/map.png' },
      }),
    );
  });

  it('shows the background, removes it, and says why a change failed', async () => {
    fetchMock.mockRejectedValue(new ApiError(422, 'Immagine troppo grande'));
    const { user } = render({ backgroundUrl: 'https://cdn/bg.webp' });
    expect(screen.getByRole('img', { name: 'Immagine di sfondo' })).toHaveAttribute('src', 'https://cdn/bg.webp');
    await user.click(screen.getByRole('button', { name: 'Rimuovi lo sfondo' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/background', { method: 'DELETE' });
    expect(await screen.findByText('Immagine troppo grande')).toBeInTheDocument();
  });

  it('ignores a file picker closed with nothing chosen', async () => {
    render();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
