import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingEditor } from '../../../components/landing/LandingEditor';
import { SectionInfoModal } from '../../../components/landing/SectionInfoModal';
import { apiFetch } from '../../../lib/apiClient';
import { toSection, type RawSection } from '../../../lib/landing';
import { rawSection, rawSections } from '../../fixtures';
import { section } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../../components/landing/Sortable', () => import('./sortableMock'));

const fetchMock = vi.mocked(apiFetch);

function Opened() {
  const location = useLocation();
  return <p>Aperta {JSON.stringify(location.state)}</p>;
}

function editor(raw = rawSections([rawSection()])) {
  const sections = (raw as unknown as RawSection[]).map(toSection);
  return renderWithProviders(
    <Routes>
      <Route path="/rooms/:roomId" element={<LandingEditor roomId="room-1" sections={sections} />} />
      <Route path="/rooms/:roomId/sections/:sectionId" element={<Opened />} />
    </Routes>,
    { route: '/rooms/room-1' },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(notifications, 'show').mockReturnValue('id');
});

describe('LandingEditor', () => {
  it('shows each card with its handle and menu, and reorders them', async () => {
    fetchMock.mockResolvedValue(rawSections([rawSection()]));
    editor();
    expect(screen.getByRole('link', { name: 'Documenti' })).toHaveAttribute('href', '/rooms/room-1/documents');
    expect(screen.getByRole('button', { name: 'Sposta Tokyo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riordina page-documents,page-maps,page-session-zero,section-1' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/order', {
      method: 'PUT',
      json: { ids: ['section-1', 'page-session-zero', 'page-maps', 'page-documents'] },
    });
  });

  it('tells when the order is refused', async () => {
    fetchMock.mockRejectedValue(new Error('No'));
    editor();
    await userEvent.click(screen.getByRole('button', { name: /^Riordina/ }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'No' })));
  });

  it('keeps the Documents card, and deletes another after asking', async () => {
    editor();
    await userEvent.click(screen.getByRole('button', { name: 'Azioni di Documenti' }));
    expect(screen.getByRole('menuitem', { name: 'Modifica info' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Elimina' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Azioni di Tokyo' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminare «Tokyo»?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Azioni di Tokyo' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fetchMock.mockRejectedValueOnce(new Error('Rifiutato'));
    await userEvent.click(screen.getByRole('button', { name: 'Azioni di Tokyo' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Rifiutato' })));

    fetchMock.mockResolvedValueOnce(undefined);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections/section-1', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens the info of a card', async () => {
    editor();
    await userEvent.click(screen.getByRole('button', { name: 'Azioni di Mappe' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Modifica info' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica info' });
    expect(within(dialog).getByRole('textbox', { name: 'Titolo' })).toHaveAttribute('placeholder', 'Mappe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('creates a Section by its title and opens it to add a block', async () => {
    editor();
    await userEvent.click(screen.getByRole('button', { name: 'Nuova sezione' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Nuova sezione' }));
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nuova sezione' }));
    const input = screen.getByRole('textbox', { name: 'Titolo' });
    expect(screen.getByRole('button', { name: 'Crea' })).toBeDisabled();
    await userEvent.type(input, '  {Enter}');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new Error('Troppe'));
    await userEvent.type(input, 'Kyoto{Enter}');
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Troppe' })));

    fetchMock.mockResolvedValueOnce(rawSection({ id: 'section-2', title: 'Kyoto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crea' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections', { method: 'POST', json: { kind: 'custom', title: '  Kyoto' } });
    expect(await screen.findByText(/Aperta/)).toHaveTextContent('"landingEdit":"add-block"');
  });

  it('adds back a page card the Master deleted', async () => {
    let refuse: (error: Error) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)) as never);
    editor([rawSections()[0], rawSection()]);
    expect(screen.getByRole('button', { name: 'Riaggiungi Mappe' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riaggiungi Sessione 0' }));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections', { method: 'POST', json: { kind: 'page_session_zero', title: null } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riaggiungi Sessione 0' })).toHaveAttribute('data-loading', 'true'));
    expect(screen.getByRole('button', { name: 'Riaggiungi Mappe' })).not.toHaveAttribute('data-loading');
    refuse(new Error('Già'));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Già' })));
  });
});

describe('SectionInfoModal', () => {
  function modal(overrides: Record<string, unknown> = {}) {
    const onClose = vi.fn();
    renderWithProviders(<SectionInfoModal roomId="room-1" section={section(overrides)} onClose={onClose} />);
    return { onClose, dialog: screen.getByRole('dialog', { name: 'Modifica info' }) };
  }

  it('saves the title and the description', async () => {
    const { onClose, dialog } = modal({ description: 'Neon' });
    const title = within(dialog).getByRole('textbox', { name: 'Titolo' });
    await userEvent.clear(title);
    expect(within(dialog).getByRole('button', { name: 'Salva' })).toBeDisabled();
    await userEvent.type(title, 'Osaka');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Descrizione' }), ' notte');
    fetchMock.mockRejectedValueOnce(new Error('Lungo'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Lungo' })));
    fetchMock.mockResolvedValueOnce(rawSection({ title: 'Osaka' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/sections/section-1', {
      method: 'PATCH',
      json: { title: 'Osaka', description: 'Neon notte' },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('changes the image by file, by URL, and removes it', async () => {
    const { dialog } = modal({ kind: 'page_maps', title: null });
    expect(within(dialog).getByRole('button', { name: 'Salva' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(rawSection({ image_url: 'http://img/one.webp' }));
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(dialog.querySelector('img')).toHaveAttribute('src', 'http://img/one.webp'));

    fetchMock.mockResolvedValueOnce(rawSection({ image_url: 'http://img/two.webp' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Da URL' }));
    await userEvent.type(screen.getByRole('textbox', { name: "URL dell'immagine" }), 'https://example.com/a.png');
    await userEvent.click(screen.getByRole('button', { name: 'Usa immagine' }));
    await waitFor(() => expect(dialog.querySelector('img')).toHaveAttribute('src', 'http://img/two.webp'));

    fetchMock.mockRejectedValueOnce(new Error('Rotto'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Rotto' })));
    fetchMock.mockResolvedValueOnce(rawSection());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi' }));
    await waitFor(() => expect(dialog.querySelector('img')).toBeNull());
  });
});
