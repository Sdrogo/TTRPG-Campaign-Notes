import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { MapLegend, legendOf } from '../../../components/maps/MapLegend';
import { MapLegendDialog } from '../../../components/maps/MapLegendDialog';
import { legendFoldKey, toMapDetail, type RawMapDetail } from '../../../lib/maps';
import type { ColorMeanings, LegendPresetRef, MapArrow, MapColor } from '../../../types/map';
import { rawMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
type Init = { method?: string; json?: unknown };

function arrow(id: string, color: MapColor): MapArrow {
  return {
    id,
    from: { cardId: 'a', groupId: null },
    to: { cardId: 'b', groupId: null },
    direction: 'forward',
    label: null,
    reverseLabel: null,
    labelPosition: null,
    reverseLabelPosition: null,
    labelOffset: null,
    reverseLabelOffset: null,
    bend: null,
    color,
    masterOnly: false,
  };
}

const arrows = [arrow('1', 'red'), arrow('2', 'green'), arrow('3', 'blue')];
const meanings: ColorMeanings = { red: 'Avversario', green: 'Alleato', pink: 'Amore' };

function rawPreset(id: string, name: string, entries: ColorMeanings, mapCount = 2) {
  return { id, name, entries, map_count: mapCount };
}

let presets = [rawPreset('preset-1', 'Corte', { red: 'Nemico', violet: 'Spia' })];

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  presets = [rawPreset('preset-1', 'Corte', { red: 'Nemico', violet: 'Spia' })];
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path === '/rooms/room-1/map-legend-presets' && init?.method === 'POST') {
      return Promise.resolve({ id: 'preset-new', map_count: 0, ...(init.json as object) });
    }
    if (path === '/rooms/room-1/map-legend-presets') return Promise.resolve(presets);
    if (path.startsWith('/rooms/room-1/map-legend-presets/') && init?.method === 'PATCH') {
      return Promise.resolve({ ...presets[0], ...(init.json as object) });
    }
    if (path.startsWith('/rooms/room-1/map-legend-presets/')) return Promise.resolve(undefined);
    return Promise.resolve(rawMapDetail());
  });
});

describe('legendOf', () => {
  it("takes a map's meanings and its preset's name", () => {
    const own = toMapDetail(rawMapDetail() as RawMapDetail);
    expect(legendOf(own)).toEqual({ mapId: 'map-1', meanings: {}, presetName: null });
    const linked = toMapDetail(
      rawMapDetail({ color_legend: { red: 'Nemico' }, legend_preset: { id: 'p', name: 'Corte' } }) as RawMapDetail,
    );
    expect(legendOf(linked)).toEqual({ mapId: 'map-1', meanings: { red: 'Nemico' }, presetName: 'Corte' });
  });
});

describe('MapLegend', () => {
  const base = { mapId: 'map-1', meanings, presetName: null, arrows, highlight: null, onHighlight: () => {} };

  it('shows nothing to a viewer, and to an editor on a phone, when no color has a meaning', () => {
    const { rerender } = renderWithProviders(<MapLegend {...base} meanings={{}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<MapLegend {...base} meanings={{}} onEdit={() => {}} compact />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers an editor a chip opening the dialog when no color has a meaning', async () => {
    const onEdit = vi.fn();
    renderWithProviders(<MapLegend {...base} meanings={{}} onEdit={onEdit} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Legenda' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('lists the used colors with a meaning and highlights one on a click', async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    const onEdit = vi.fn();
    const { rerender } = renderWithProviders(
      <MapLegend {...base} presetName="Corte" onEdit={onEdit} onHighlight={onHighlight} />,
    );
    const list = screen.getByRole('list', { name: 'Legenda' });
    const rows = within(list).getAllByRole('listitem');
    // Red and green: blue has no meaning, pink no relation.
    expect(rows.map((row) => row.textContent)).toEqual(['Avversario', 'Alleato']);
    expect(screen.getByText('Preset: Corte')).toBeInTheDocument();
    await user.click(rows[1]);
    expect(onHighlight).toHaveBeenLastCalledWith('green');
    await user.click(screen.getByRole('button', { name: 'Modifica legenda' }));
    expect(onEdit).toHaveBeenCalled();

    rerender(<MapLegend {...base} highlight="green" onHighlight={onHighlight} />);
    const on = screen.getByRole('listitem', { name: 'Verde: Alleato' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/premi Esc/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica legenda' })).not.toBeInTheDocument();
    await user.click(on);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('folds to a chip and remembers it per map', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<MapLegend {...base} />);
    await user.click(screen.getByRole('button', { name: 'Chiudi legenda' }));
    expect(localStorage.getItem(legendFoldKey('map-1'))).toBe('1');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<MapLegend {...base} />);
    await user.click(screen.getByRole('button', { name: 'Legenda · 2' }));
    expect(screen.getByRole('list', { name: 'Legenda' })).toBeInTheDocument();
    expect(localStorage.getItem(legendFoldKey('map-1'))).toBeNull();
  });

  it('opens a drawer from a chip on a phone', async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    renderWithProviders(<MapLegend {...base} presetName="Corte" compact onHighlight={onHighlight} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Legenda · 2' }));
    const drawer = await screen.findByRole('dialog', { name: 'Legenda' });
    expect(within(drawer).getByText('Preset: Corte')).toBeInTheDocument();
    expect(within(drawer).getByText('Tocca un significato per evidenziarne le relazioni.')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('listitem', { name: 'Rosso: Avversario' }));
    expect(onHighlight).toHaveBeenCalledWith('red');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

function renderDialog(
  overrides: { meanings?: ColorMeanings; preset?: LegendPresetRef | null; isMaster?: boolean; arrows?: MapArrow[] } = {},
) {
  const onClose = vi.fn();
  renderWithProviders(
    <MapLegendDialog
      roomId="room-1"
      mapId="map-1"
      meanings={overrides.meanings ?? meanings}
      preset={overrides.preset ?? null}
      arrows={overrides.arrows ?? arrows}
      isMaster={overrides.isMaster ?? true}
      onClose={onClose}
    />,
  );
  return { user: userEvent.setup(), onClose };
}

const boardCall = (json: unknown) =>
  expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/map-1/board', { method: 'PATCH', json });

describe('MapLegendDialog', () => {
  it("edits the map's own meanings: used colors first, the others folded", async () => {
    const { user, onClose } = renderDialog();
    expect(await screen.findByRole('dialog', { name: 'Legenda dei colori' })).toBeInTheDocument();
    const red = screen.getByRole('textbox', { name: 'Significato di Rosso' });
    expect(red).toHaveValue('Avversario');
    expect(screen.getByRole('textbox', { name: 'Significato di Azzurro' })).toHaveValue('');
    // Pink means something but no relation uses it.
    const unused = screen.getByRole('button', { name: /1 significato di un colore non usato qui/ });
    expect(unused).toHaveAttribute('aria-expanded', 'false');
    await user.click(unused);
    expect(unused).toHaveAttribute('aria-expanded', 'true');
    await user.click(unused);

    await user.click(screen.getByRole('button', { name: 'Togli il significato di Rosso' }));
    await user.type(screen.getByRole('textbox', { name: 'Significato di Azzurro' }), '  Debito ');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    boardCall({ legend: { meanings: { green: 'Alleato', blue: 'Debito', pink: 'Amore' } } });
  });

  it('says when the map has no relations, and saves nothing as a preset without meanings', async () => {
    renderDialog({ meanings: {}, arrows: [] });
    expect(await screen.findByText('Questa mappa non ha ancora relazioni.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva come preset' })).toBeDisabled();
  });

  it('shows an error the API answers', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/rooms/room-1/map-legend-presets' ? Promise.resolve([]) : Promise.reject(new ApiError(422, 'Troppo lungo')),
    );
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Troppo lungo');
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets the Master edit a linked map's preset for every map", async () => {
    const { user, onClose } = renderDialog({ meanings: { red: 'Nemico' }, preset: { id: 'preset-1', name: 'Corte' } });
    expect(await screen.findByText(/le modifiche lo aggiornano su 2 mappe/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salva come preset' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Significato di Verde' }), 'Amico');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/map-legend-presets/preset-1', {
      method: 'PATCH',
      json: { entries: { red: 'Nemico', green: 'Amico' } },
    });
  });

  it('counts one map while the presets load', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderDialog({ meanings: {}, preset: { id: 'preset-1', name: 'Corte' } });
    expect(await screen.findByText(/le modifiche lo aggiornano su 1 mappa\./)).toBeInTheDocument();
  });

  it('shows anyone else a linked map read-only, and unlinks it keeping a copy', async () => {
    const { user, onClose } = renderDialog({
      meanings: { red: 'Nemico' },
      preset: { id: 'preset-1', name: 'Corte' },
      isMaster: false,
    });
    expect(await screen.findByText(/solo il Master ne cambia i significati/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Nemico')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gestisci preset' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scollega dal preset' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    boardCall({ legend: { meanings: { red: 'Nemico' } } });
  });

  it('applies a Room preset, warning about the meanings it replaces', async () => {
    presets = [...presets, rawPreset('preset-2', 'Gilde', { green: 'Alleato' }, 1)];
    const { user, onClose } = renderDialog({ isMaster: false });
    await user.click(await screen.findByRole('button', { name: 'Applica preset' }));
    expect(await screen.findByRole('dialog', { name: 'Applica un preset' })).toBeInTheDocument();
    // The first preset is chosen: it changes red and drops green and pink.
    expect(await screen.findByText('Applicarlo sostituisce 3 significati di questa mappa.')).toBeInTheDocument();
    expect(screen.getByText('2 mappe')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Gilde/ }));
    expect(screen.getByText('Applicarlo sostituisce 2 significati di questa mappa.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Applica' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    boardCall({ legend: { preset_id: 'preset-2' } });
  });

  it('applies without a warning when nothing is replaced, and says when the Room has no presets', async () => {
    presets = [rawPreset('preset-1', 'Corte', { red: 'Avversario', green: 'Alleato', pink: 'Amore' })];
    const { user } = renderDialog({ isMaster: false });
    await user.click(await screen.findByRole('button', { name: 'Applica preset' }));
    expect(await screen.findByRole('radio', { name: /Corte/ })).toBeChecked();
    expect(screen.queryByText(/sostituisce/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    presets = [];
  });

  it('has nothing to apply in a Room without presets', async () => {
    presets = [];
    const { user } = renderDialog({ isMaster: false });
    await user.click(await screen.findByRole('button', { name: 'Applica preset' }));
    expect(await screen.findByText('Questa Room non ha ancora preset.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Applica' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('dialog', { name: 'Legenda dei colori' })).toBeInTheDocument();
  });

  it('saves the map as a preset and links it', async () => {
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Salva come preset' }));
    const save = screen.getByRole('button', { name: 'Salva' });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Nome del preset' }), ' Gilde ');
    await user.click(save);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/map-legend-presets', {
      method: 'POST',
      json: { name: 'Gilde', entries: { red: 'Avversario', green: 'Alleato', pink: 'Amore' } },
    });
    boardCall({ legend: { preset_id: 'preset-new' } });
  });

  it('goes back from saving as a preset', async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Salva come preset' }));
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('dialog', { name: 'Legenda dei colori' })).toBeInTheDocument();
  });

  it("manages the Room's presets: edit, create and delete", async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Gestisci preset' }));
    expect(await screen.findByText('Corte')).toBeInTheDocument();

    // Edit: rename, drop a color, add one.
    await user.click(screen.getByRole('button', { name: 'Modifica Corte' }));
    expect(await screen.findByRole('dialog', { name: 'Modifica preset' })).toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Nome del preset' });
    expect(name).toHaveValue('Corte');
    await user.clear(name);
    await user.type(name, 'Corte nuova');
    await user.click(screen.getByRole('button', { name: 'Togli il significato di Viola' }));
    await user.click(screen.getByPlaceholderText('Aggiungi un colore'));
    await user.click(await screen.findByRole('option', { name: 'Verde' }));
    await user.type(screen.getByRole('textbox', { name: 'Significato di Verde' }), 'Amico');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/map-legend-presets/preset-1', {
        method: 'PATCH',
        json: { name: 'Corte nuova', entries: { red: 'Nemico', green: 'Amico' } },
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Preset della Room' })).toBeInTheDocument();

    // Create: a name and one meaning at least.
    await user.click(screen.getByRole('button', { name: 'Nuovo preset' }));
    expect(await screen.findByRole('dialog', { name: 'Nuovo preset' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Salva' });
    await user.type(screen.getByRole('textbox', { name: 'Nome del preset' }), 'Clan');
    expect(save).toBeDisabled();
    await user.click(screen.getByPlaceholderText('Aggiungi un colore'));
    await user.click(await screen.findByRole('option', { name: 'Rosso' }));
    await user.type(screen.getByRole('textbox', { name: 'Significato di Rosso' }), 'Sangue');
    await user.click(save);
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/map-legend-presets', {
        method: 'POST',
        json: { name: 'Clan', entries: { red: 'Sangue' } },
      }),
    );

    // Delete, after a second thought.
    await user.click(await screen.findByRole('button', { name: 'Elimina Corte' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await user.click(screen.getByRole('button', { name: 'Elimina Corte' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/map-legend-presets/preset-1', { method: 'DELETE' }),
    );

    // Back out of a preset, then out of the list.
    await user.click(screen.getByRole('button', { name: 'Nuovo preset' }));
    await user.click(await screen.findByRole('button', { name: 'Indietro' }));
    await user.click(await screen.findByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('dialog', { name: 'Legenda dei colori' })).toBeInTheDocument();
  });

  it('offers every color to a new preset until all are taken', async () => {
    presets = [];
    const { user } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Gestisci preset' }));
    expect(await screen.findByText('Questa Room non ha ancora preset.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nuovo preset' }));
    const add = await screen.findByPlaceholderText('Aggiungi un colore');
    for (let left = 17; left > 0; left -= 1) {
      await user.click(screen.getByPlaceholderText('Aggiungi un colore'));
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(left);
      await user.click(options[0]);
    }
    expect(add).not.toBeInTheDocument();
  });
});
