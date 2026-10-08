import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { saveBlob } from '../../lib/roomExport';
import { renderWithProviders } from '../utils';
import { ExportDocumentModal } from '../../components/ExportDocumentModal';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiDownload: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../lib/roomExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/roomExport')>()),
  saveBlob: vi.fn(),
}));

const onClose = vi.fn();
const blob = new Blob(['# Il Cancello']);

function render() {
  renderWithProviders(
    <ExportDocumentModal
      opened
      onClose={onClose}
      roomId="room-1"
      documentId="doc-1"
      documentName="Il Cancello"
    />,
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(apiDownload).mockReset().mockResolvedValue(blob);
  vi.mocked(saveBlob).mockReset();
  vi.mocked(notifyError).mockReset();
  vi.mocked(notifySuccess).mockReset();
  onClose.mockReset();
});

describe('ExportDocumentModal (spec 27)', () => {
  it('downloads the Document as Markdown by default, named after it', async () => {
    const { user } = render();

    expect(await screen.findByRole('dialog', { name: 'Esporta il Documento' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Markdown' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Esporta' }));

    await waitFor(() =>
      expect(apiDownload).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/export?format=md'),
    );
    expect(saveBlob).toHaveBeenCalledWith(
      blob,
      expect.stringMatching(/^il-cancello-\d{4}-\d{2}-\d{2}\.md$/),
    );
    expect(notifySuccess).toHaveBeenCalledWith('Esportazione scaricata.');
    expect(onClose).toHaveBeenCalled();
  });

  it('downloads JSON when it is chosen, and says the links expire', async () => {
    const { user } = render();

    await user.click(screen.getByText('JSON'));
    expect(screen.getByText(/I link a immagini e file PDF scadono/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Esporta' }));

    await waitFor(() =>
      expect(apiDownload).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/export?format=json'),
    );
    expect(saveBlob).toHaveBeenCalledWith(blob, expect.stringMatching(/\.json$/));
  });

  it('reports a failure and keeps the dialog open', async () => {
    const failure = new Error('nope');
    vi.mocked(apiDownload).mockRejectedValue(failure);
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Esporta' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(failure);
    expect(saveBlob).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be cancelled', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onClose).toHaveBeenCalled();
    expect(apiDownload).not.toHaveBeenCalled();
  });
});
