import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload, apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { saveBlob } from '../../lib/roomExport';
import { ViewAsContext } from '../../hooks/useViewAs';
import { rawPdfJob } from '../fixtures';
import { renderWithProviders } from '../utils';
import { ExportDocumentModal } from '../../components/ExportDocumentModal';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiDownload: vi.fn(),
  apiFetch: vi.fn(),
}));
vi.mock('../../hooks/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'user-1' } }, loading: false }),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../lib/roomExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/roomExport')>()),
  saveBlob: vi.fn(),
}));

const onClose = vi.fn();
const blob = new Blob(['# Il Cancello']);

function render(wrapper?: Parameters<typeof renderWithProviders>[1]) {
  renderWithProviders(
    <ExportDocumentModal
      opened
      onClose={onClose}
      roomId="room-1"
      documentId="doc-1"
      documentName="Il Cancello"
    />,
    wrapper,
  );
  return { user: userEvent.setup() };
}

// What `GET .../exports` answers once the PDF has been requested.
let jobs: unknown[] = [];

beforeEach(() => {
  jobs = [];
  vi.mocked(apiFetch)
    .mockReset()
    .mockImplementation((path: string) => {
      if (path === '/rooms/room-1/exports') return Promise.resolve(jobs);
      if (path === '/rooms/room-1/exports/pdf') return Promise.resolve(rawPdfJob());
      return Promise.resolve(undefined);
    });
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

  it('makes a PDF of the Document with no Tag filter or cover, then follows it (spec 27b)', async () => {
    const { user } = render();

    await screen.findByRole('dialog', { name: 'Esporta il Documento' });
    await user.click(screen.getByText('PDF'));
    expect(screen.getByRole('radio', { name: /Gotico/ })).toBeChecked();
    expect(
      screen.queryByRole('combobox', { name: 'Immagine di copertina' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Includi i Commenti in appendice' }));
    jobs = [
      rawPdfJob({
        status: 'running',
        document_id: 'doc-1',
        document_name: 'Il Cancello',
      }),
    ];
    await user.click(screen.getByRole('button', { name: 'Genera PDF' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1/exports/pdf', {
        method: 'POST',
        json: {
          style: 'gothic',
          page_size: 'A4',
          include_comments: true,
          include_attachments: false,
          document_id: 'doc-1',
          view_as_user_id: null,
        },
        ignoreViewAs: true,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/PDF/);
    expect(apiDownload).not.toHaveBeenCalled();
  });

  it("follows this Document's PDF being made, not a Room PDF", async () => {
    jobs = [rawPdfJob({ id: 'room-job', status: 'running' })];
    const { user } = render();

    await screen.findByRole('dialog', { name: 'Esporta il Documento' });
    await user.click(screen.getByText('PDF'));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1/exports', expect.anything()),
    );
    expect(screen.getByRole('button', { name: 'Genera PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('opens on a PDF of this Document that is still being made', async () => {
    jobs = [rawPdfJob({ status: 'running', document_id: 'doc-1', document_name: 'Il Cancello' })];
    const { user } = render();

    await screen.findByRole('dialog', { name: 'Esporta il Documento' });
    await user.click(screen.getByText('PDF'));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Genera PDF' })).not.toBeInTheDocument();
  });

  it('goes back to the form after a failed PDF, and closes from the job panel', async () => {
    const { user } = render();
    await screen.findByRole('dialog', { name: 'Esporta il Documento' });
    await user.click(screen.getByText('PDF'));
    jobs = [rawPdfJob({ status: 'failed', document_id: 'doc-1', document_name: 'Il Cancello' })];
    await user.click(screen.getByRole('button', { name: 'Genera PDF' }));

    await user.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(screen.getByRole('button', { name: 'Genera PDF' })).toBeInTheDocument();

    jobs = [rawPdfJob({ status: 'running', document_id: 'doc-1', document_name: 'Il Cancello' })];
    await user.click(screen.getByRole('button', { name: 'Genera PDF' }));
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says the PDF is made as the member being previewed (spec 22b)', async () => {
    const { user } = render({
      wrapper: ({ children }) => (
        <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'alice' }}>
          {children}
        </ViewAsContext.Provider>
      ),
    });

    await screen.findByRole('dialog', { name: 'Esporta il Documento' });
    await user.click(screen.getByText('PDF'));

    expect(screen.getByText(/come un altro membro/)).toBeInTheDocument();
  });
});
