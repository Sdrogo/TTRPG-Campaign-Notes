import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload, apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { saveBlob } from '../../lib/roomExport';
import { rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { ExportRoomModal } from '../../components/ExportRoomModal';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../lib/roomExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/roomExport')>()),
  saveBlob: vi.fn(),
}));

const onClose = vi.fn();
const blob = new Blob(['# La Cripta']);

const rawTags = [
  { id: 'npc', name: 'NPC', category: 'Type', main_position: 0 },
  { id: 'place', name: 'Luogo', category: null, main_position: null },
];

function render() {
  // The dialog's own state is reset when it is closed and opened again.
  function Host() {
    const [opened, setOpened] = useState(true);
    return (
      <ExportRoomModal
        opened={opened}
        onClose={() => {
          onClose();
          setOpened(false);
        }}
        roomId="room-1"
      />
    );
  }
  renderWithProviders(<Host />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiDownload).mockReset();
  vi.mocked(saveBlob).mockReset();
  vi.mocked(notifyError).mockReset();
  vi.mocked(notifySuccess).mockReset();
  onClose.mockReset();
  vi.mocked(apiDownload).mockResolvedValue(blob);
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/rooms/room-1') return Promise.resolve(rawRoom());
    if (path === '/rooms/room-1/tags') return Promise.resolve(rawTags);
    return Promise.resolve(undefined);
  });
});

const exportButton = () => screen.getByRole('button', { name: 'Esporta' });

describe('ExportRoomModal', () => {
  it('offers Markdown first and says what each format is for', async () => {
    const { user } = render();

    expect(await screen.findByRole('dialog', { name: 'Esporta la Stanza' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Markdown' })).toBeChecked();
    expect(screen.getByText('Un solo file leggibile, da leggere o stampare.')).toBeInTheDocument();

    await user.click(screen.getByText('JSON'));
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(
      screen.getByText('Dati strutturati con gli id, per strumenti e Agenti AI.'),
    ).toBeInTheDocument();
  });

  it('tells that the links to images and PDFs expire', async () => {
    render();

    expect(
      await screen.findByText(/I link a immagini e file PDF scadono entro un'ora/),
    ).toBeInTheDocument();
  });

  it('downloads the whole Room as the chosen format, named after it, and closes', async () => {
    const { user } = render();
    await waitFor(() => expect(exportButton()).toBeEnabled());

    await user.click(screen.getByText('JSON'));
    await user.click(exportButton());

    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(apiDownload).toHaveBeenCalledWith('/rooms/room-1/export?format=json');
    const [saved, fileName] = vi.mocked(saveBlob).mock.calls[0];
    expect(saved).toBe(blob);
    expect(fileName).toMatch(/^la-cripta-\d{4}-\d{2}-\d{2}\.json$/);
    expect(notifySuccess).toHaveBeenCalledWith('Esportazione scaricata.');
    expect(onClose).toHaveBeenCalled();
  });

  it('exports only the Documents with the chosen Tags (FR-N2, spec 23 Decision 6)', async () => {
    const { user } = render();
    await waitFor(() => expect(exportButton()).toBeEnabled());

    await user.click(screen.getByRole('combobox', { name: /Solo i Documenti con questi Tag/ }));
    await user.click(await screen.findByRole('option', { name: '#NPC' }));
    await user.click(screen.getByRole('option', { name: '#Luogo' }));
    await user.click(screen.getByRole('button', { name: 'Esporta' }));

    await waitFor(() => expect(apiDownload).toHaveBeenCalled());
    expect(apiDownload).toHaveBeenCalledWith('/rooms/room-1/export?format=md&tag=npc&tag=place');
  });

  it('waits for the Room before it can name the file', async () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => undefined));
    render();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });

  it('shows the backend error and stays open when the export fails', async () => {
    const error = new Error('Non sei membro');
    vi.mocked(apiDownload).mockRejectedValue(error);
    const { user } = render();
    await waitFor(() => expect(exportButton()).toBeEnabled());

    await user.click(exportButton());

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);
    expect(saveBlob).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Cancel without downloading', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Annulla' }));

    expect(onClose).toHaveBeenCalled();
    expect(apiDownload).not.toHaveBeenCalled();
  });

  it('asks for nothing while it is closed', () => {
    renderWithProviders(<ExportRoomModal opened={false} onClose={onClose} roomId="room-1" />);

    expect(apiFetch).not.toHaveBeenCalled();
  });
});
