import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapImportModal } from '../../../components/maps/MapImportModal';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import type { Member } from '../../../types/member';
import { rawGeoMapDetail } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
type Init = { method?: string; json?: unknown };

const report = (overrides: Record<string, unknown> = {}) => ({
  name: 'Shibuya di notte',
  description: 'Le zone',
  plane_width: 2025,
  plane_height: 1852,
  areas: 6,
  pins: 14,
  links: 4,
  matched: 8,
  not_found: ['Elysium', 'Bar Senza Nome'],
  ambiguous: ['Gemello'],
  repeated: [],
  ...overrides,
});

const routes = {
  preview: () => Promise.resolve(report()) as Promise<unknown>,
  import: () => Promise.resolve(rawGeoMapDetail({ id: 'map-9' })) as Promise<unknown>,
};

function member(userId: string, displayName: string): Member {
  return { userId, displayName, role: 'player', isAdmin: false, email: null, pronouns: null, bio: null, avatarUrl: null };
}

const onImported = vi.fn();
const onClose = vi.fn();

function render() {
  renderWithProviders(
    <MapImportModal
      roomId="room-1"
      members={[member('user-1', 'Andrea'), member('user-2', 'Bea')]}
      creatorId="user-1"
      defaultVisibility="master"
      onImported={onImported}
      onClose={onClose}
    />,
  );
  return userEvent.setup();
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function jsonFile(content = '{"schema_version": 1}', name = 'shibuya.json') {
  return new File([content], name, { type: 'application/json' });
}

beforeEach(() => {
  fetchMock.mockReset();
  onImported.mockReset();
  onClose.mockReset();
  routes.preview = () => Promise.resolve(report());
  routes.import = () => Promise.resolve(rawGeoMapDetail({ id: 'map-9' }));
  fetchMock.mockImplementation((path: string) => {
    if (path === '/rooms/room-1/maps/import/preview') return routes.preview();
    if (path === '/rooms/room-1/maps/import') return routes.import();
    return Promise.resolve([]);
  });
});

describe('MapImportModal (spec 38_3)', () => {
  it('reads the file, reports what it holds and imports it under the chosen name', async () => {
    const user = render();
    expect(screen.getByText('Nessun file scelto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importa' })).toBeDisabled();

    await user.upload(fileInput(), jsonFile());

    expect(await screen.findByText('Aree: 6 · Luoghi: 14 · Collegamenti: 4')).toBeInTheDocument();
    expect(screen.getByText('shibuya.json')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Piano 2025 × 1852 · legati a un Documento: 8');
    expect(screen.getByText('Elysium')).toBeInTheDocument();
    expect(screen.getByText('Bar Senza Nome')).toBeInTheDocument();
    expect(screen.getByText('Gemello')).toBeInTheDocument();
    expect(screen.queryByText(/già sulla mappa/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/maps/import/preview', {
      method: 'POST',
      json: { map: { schema_version: 1 } },
    });
    expect(screen.getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master (e te)');
    const name = screen.getByRole('textbox', { name: /Nome/ });
    expect(name).toHaveValue('Shibuya di notte');
    expect(screen.getByRole('textbox', { name: 'Descrizione' })).toHaveValue('Le zone');

    await user.clear(name);
    expect(screen.getByRole('button', { name: 'Importa' })).toBeDisabled();
    await user.type(name, 'Shibuya');
    await user.clear(screen.getByRole('textbox', { name: 'Descrizione' }));
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0][0]).toMatchObject({ id: 'map-9', kind: 'geographic' });
    const [, init] = fetchMock.mock.calls.find(([path]) => path === '/rooms/room-1/maps/import') as [string, Init];
    expect(init).toEqual({
      method: 'POST',
      json: { map: { schema_version: 1 }, name: 'Shibuya', description: '', visibility: 'master', selective_user_ids: [] },
    });
  });

  it('shares the new map with chosen members', async () => {
    const user = render();
    await user.upload(fileInput(), jsonFile());
    await user.click(await screen.findByRole('combobox', { name: 'Visibilità' }));
    await user.click(screen.getByRole('option', { name: /Selettivo/ }));
    await user.click(screen.getByRole('combobox', { name: 'Membri che possono vedere la mappa' }));
    expect(screen.queryByText('Andrea')).not.toBeInTheDocument();
    await user.click(screen.getByText('Bea'));
    await user.click(screen.getByRole('button', { name: 'Importa' }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/maps/import',
        expect.objectContaining({ json: expect.objectContaining({ visibility: 'selective', selective_user_ids: ['user-2'] }) }),
      ),
    );
  });

  it('lists the names of Documents already on the map', async () => {
    routes.preview = () => Promise.resolve(report({ not_found: [], ambiguous: [], repeated: ['Hachikō'] }));
    const user = render();
    await user.upload(fileInput(), jsonFile());
    expect(await screen.findByText('Hachikō')).toBeInTheDocument();
    expect(screen.getByText(/già sulla mappa/)).toBeInTheDocument();
  });

  it('refuses a file that is not JSON, then reads another one', async () => {
    const user = render();
    await user.upload(fileInput(), jsonFile('not json', 'notes.md'));
    expect(await screen.findByText('Il file non è un JSON valido.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('notes.md')).toBeInTheDocument();

    await user.upload(fileInput(), jsonFile());
    expect(await screen.findByText('Aree: 6 · Luoghi: 14 · Collegamenti: 4')).toBeInTheDocument();
    expect(screen.queryByText('Il file non è un JSON valido.')).not.toBeInTheDocument();
  });

  it('shows why the file was refused, and why the import failed', async () => {
    routes.preview = () => Promise.reject(new ApiError(422, 'Il segnaposto "sky" è fuori dal piano'));
    const user = render();
    await user.upload(fileInput(), jsonFile());
    expect(await screen.findByText('Il segnaposto "sky" è fuori dal piano')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importa' })).toBeDisabled();

    routes.preview = () => Promise.resolve(report());
    routes.import = () => Promise.reject(new ApiError(409, 'Troppe mappe'));
    await user.upload(fileInput(), jsonFile());
    await user.click(await screen.findByRole('button', { name: 'Importa' }));
    expect(await screen.findByText('Troppe mappe')).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('ignores a cancelled file choice, and closes', async () => {
    const user = render();
    fileInput().dispatchEvent(new Event('change', { bubbles: true }));
    expect(screen.getByText('Nessun file scelto')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
