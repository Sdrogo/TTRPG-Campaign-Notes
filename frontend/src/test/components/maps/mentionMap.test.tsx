import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { toMapDetail, toMentionMap, type RawMapDetail, type RawMentionMap } from '../../../lib/maps';
import { MentionMapModal } from '../../../components/maps/MentionMapModal';
import { MentionMapPanel } from '../../../components/maps/MentionMapPanel';
import { LinkedMapPanel } from '../../../components/maps/LinkedMapPanel';
import { rawMap, rawMapDetail, rawMentionMap } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ...(await import('../../xyflowMock')).xyflowMock,
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const PATH = '/rooms/room-1/documents/doc-1/mention-map';
type Init = { method?: string; json?: unknown };

let preview: (depth: string) => Promise<unknown>;
let write: (init: Init) => Promise<unknown>;
let maps: unknown[];
let addTo: (init: Init) => Promise<unknown>;

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  preview = (depth) =>
    Promise.resolve(
      depth === '0'
        ? { documents: 2, relations: 3, documents_left_out: 0 }
        : { documents: 160, relations: 300, documents_left_out: 11 },
    );
  write = (init) => Promise.resolve(init.method === 'DELETE' ? undefined : rawMentionMap());
  maps = [];
  addTo = () => Promise.resolve(rawMapDetail({ id: 'map-1' }));
  fetchMock.mockImplementation((path: string, init?: Init) => {
    if (path.startsWith(`${PATH}/preview`)) return preview(path.split('depth=')[1]);
    if (path === `${PATH}/copy`) return Promise.resolve(rawMapDetail({ id: 'map-9' }));
    if (path === `${PATH}/add-to-map`) return addTo(init!);
    if (path === PATH) return write(init!);
    if (path === '/rooms/room-1/maps') return Promise.resolve(maps);
    return Promise.resolve([]);
  });
});

function renderModal(map: ReturnType<typeof toMentionMap> | null = null) {
  const onClose = vi.fn();
  renderWithProviders(
    <MentionMapModal roomId="room-1" documentId="doc-1" documentName="Mira" map={map} onClose={onClose} />,
  );
  return { onClose, user: userEvent.setup() };
}

describe('MentionMapModal', () => {
  it('previews each depth and creates the map', async () => {
    const { onClose, user } = renderModal();
    expect(screen.getByLabelText("Calcolo dell'anteprima")).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Documenti: 2 · Relazioni: 3');
    expect(screen.queryByLabelText("Calcolo dell'anteprima")).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '1' }));
    expect(await screen.findByText(/150 carte: 11/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Elimina mappa' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Crea mappa' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(PATH, { method: 'POST', json: { depth: 1 } });
  });

  it('says when there is nothing to map yet', async () => {
    preview = () => Promise.resolve({ documents: 0, relations: 0, documents_left_out: 0 });
    renderModal();
    expect(await screen.findByText('Ancora nessuna menzione')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crea mappa' })).toBeDisabled();
  });

  it('shows why the preview or the save failed', async () => {
    preview = () => Promise.reject(new ApiError(500, 'Anteprima rotta'));
    renderModal();
    expect(await screen.findByText('Anteprima rotta')).toBeInTheDocument();
  });

  it('changes an existing map, copies it, and deletes it after confirming', async () => {
    const map = toMentionMap(rawMentionMap({ depth: 1 }) as RawMentionMap);
    const { onClose, user } = renderModal(map);
    expect(await screen.findByText(/150 carte/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(PATH, { method: 'PATCH', json: { depth: 1 } }));

    await user.click(screen.getByRole('button', { name: 'Copia come mappa libera' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/room-1/maps/map-9', {
        state: { from: '/' },
      }));
    expect(fetchMock).toHaveBeenCalledWith(`${PATH}/copy`, { method: 'POST', json: { name: 'Menzioni di Mira' } });

    await user.click(screen.getByRole('button', { name: 'Elimina mappa' }));
    expect(screen.getByText('I Documenti e le loro menzioni restano.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await user.click(screen.getByRole('button', { name: 'Elimina mappa' }));
    onClose.mockReset();
    await user.click(screen.getByRole('button', { name: 'Elimina' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(PATH, { method: 'DELETE' });
  });

  it('adds the mentions to an existing map the user manages, which is linked to the Document', async () => {
    maps = [rawMap({ id: 'map-1', name: 'La Corte' }), rawMap({ id: 'map-2', name: 'Altrui', can_edit: false })];
    const { onClose, user } = renderModal();
    const select = await screen.findByRole('combobox', { name: 'Mappa' });
    expect(screen.getByRole('option', { name: 'Nuova mappa delle menzioni' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Altrui' })).not.toBeInTheDocument();
    expect(screen.queryByText(/una volta sola/)).not.toBeInTheDocument();
    await screen.findByRole('status');
    await user.click(screen.getByRole('radio', { name: '1' }));

    await user.selectOptions(select, 'La Corte');
    expect(screen.getByText(/una volta sola/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crea mappa' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aggiungi alla mappa' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`${PATH}/add-to-map`, {
      method: 'POST',
      json: { map_id: 'map-1', depth: 1 },
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers the existing maps beside the Document's own map, and shows a refusal", async () => {
    maps = [rawMap({ id: 'map-1', name: 'La Corte' })];
    addTo = () => Promise.reject(new ApiError(409, 'Troppe carte'));
    const map = toMentionMap(rawMentionMap() as RawMentionMap);
    const { user } = renderModal(map);
    const select = await screen.findByRole('combobox', { name: 'Mappa' });
    expect(screen.getByRole('button', { name: 'Elimina mappa' })).toBeInTheDocument();
    await user.selectOptions(select, 'La Corte');
    expect(screen.queryByRole('button', { name: 'Elimina mappa' })).not.toBeInTheDocument();
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Aggiungi alla mappa' }));
    expect(await screen.findByText('Troppe carte')).toBeInTheDocument();
    await user.selectOptions(select, 'La mappa delle menzioni di questo Documento');
    expect(screen.getByRole('button', { name: 'Salva' })).toBeInTheDocument();
  });

  it('shows why a save was refused', async () => {
    write = () => Promise.reject(new ApiError(409, 'Esiste già'));
    const { user } = renderModal();
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Crea mappa' }));
    expect(await screen.findByText('Esiste già')).toBeInTheDocument();
  });
});

describe('MentionMapPanel', () => {
  it('draws the map read-only with a link to the full page', () => {
    renderWithProviders(<MentionMapPanel roomId="room-1" map={toMentionMap(rawMentionMap() as RawMentionMap)} />);
    expect(screen.getByRole('region', { name: 'Mappa delle menzioni' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schermo intero' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1/mention-map',
    );
    expect(screen.getByText('Thorn')).toBeInTheDocument();
    expect(screen.queryByText(/150 carte/)).not.toBeInTheDocument();
  });

  it('says how many Documents the cap left out', () => {
    renderWithProviders(
      <MentionMapPanel roomId="room-1" map={toMentionMap(rawMentionMap({ documents_left_out: 4 }) as RawMentionMap)} />,
    );
    expect(screen.getByText(/150 carte: 4/)).toBeInTheDocument();
  });
});

describe('LinkedMapPanel', () => {
  const LINKED = '/rooms/room-1/documents/doc-1/linked-map';
  const map = () => toMapDetail(rawMapDetail({ id: 'map-1', name: 'La Corte' }) as RawMapDetail);

  it('draws the map read-only with a link to its page, and unlinks it', async () => {
    renderWithProviders(<LinkedMapPanel roomId="room-1" documentId="doc-1" map={map()} canUnlink />);
    expect(screen.getByRole('region', { name: 'La Corte' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schermo intero' })).toHaveAttribute('href', '/rooms/room-1/maps/map-1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Togli dalla pagina del Documento' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(LINKED, { method: 'DELETE' }));
  });

  it('shows why unlinking failed, and offers no unlink to who may not', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new ApiError(403, 'Non puoi')));
    renderWithProviders(<LinkedMapPanel roomId="room-1" documentId="doc-1" map={map()} canUnlink />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Togli dalla pagina del Documento' }));
    expect(await screen.findByText('Non puoi')).toBeInTheDocument();
    cleanup();
    renderWithProviders(<LinkedMapPanel roomId="room-1" documentId="doc-1" map={map()} canUnlink={false} />);
    expect(screen.queryByRole('button', { name: 'Togli dalla pagina del Documento' })).not.toBeInTheDocument();
  });
});
