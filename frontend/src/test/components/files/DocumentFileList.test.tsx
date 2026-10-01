import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError } from '../../../lib/notify';
import { openPdf, toDocumentFile, type RawDocumentFile } from '../../../lib/documentFiles';
import { rawDocumentFile } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { DocumentFileList } from '../../../components/files/DocumentFileList';
import type { DocumentFile } from '../../../types/documentFile';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../../lib/documentFiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/documentFiles')>()),
  openPdf: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const BASE = '/rooms/room-1/documents/doc-1/files';

function file(overrides: Record<string, unknown> = {}): DocumentFile {
  return toDocumentFile(rawDocumentFile(overrides) as RawDocumentFile);
}

function render(files: DocumentFile[], canUpload = true) {
  renderWithProviders(
    <div data-testid="host">
      <DocumentFileList roomId="room-1" documentId="doc-1" files={files} canUpload={canUpload} />
    </div>,
  );
  return { host: screen.getByTestId('host'), user: userEvent.setup() };
}

function uploadInput(host: HTMLElement): HTMLInputElement {
  return host.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
}

const pdf = () => new File(['%PDF-1.7'], 'scheda.pdf', { type: 'application/pdf' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(openPdf).mockReset();
});

describe('what is shown', () => {
  // A reader of a Document without files sees it as before spec 16.
  it('renders nothing with no files and no right to upload', () => {
    const { host } = render([], false);

    expect(host).toBeEmptyDOMElement();
  });

  it('tells an Owner there are no files yet and offers the upload', () => {
    render([]);

    expect(screen.getByText('Nessun PDF allegato.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carica PDF' })).toBeEnabled();
  });

  // VR-12: whoever sees the Document sees its files, so a reader gets them
  // all, with open and download but no upload or delete.
  it('lists every file for a reader, without upload or delete', () => {
    render([file(), file({ id: 'file-2', name: 'Mappa.pdf', can_delete: false })], false);

    expect(screen.getByText('Scheda di Aria.pdf')).toBeInTheDocument();
    expect(screen.getByText('Mappa.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carica PDF' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apri Mappa.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scarica Mappa.pdf' })).toHaveAttribute(
      'href',
      'https://storage.example/file-1.pdf?token=t&download=Scheda',
    );
    expect(screen.queryByRole('button', { name: 'Elimina Mappa.pdf' })).not.toBeInTheDocument();
  });

  it('shows the size and upload date', () => {
    render([file()]);

    expect(screen.getByText(/^2,4 MB · /)).toBeInTheDocument();
  });

  // The delete control follows the backend's can_delete, not a local rule.
  it('offers delete only on files the backend marks deletable', () => {
    render([file({ can_delete: false })], true);

    expect(screen.queryByRole('button', { name: 'Elimina Scheda di Aria.pdf' })).not.toBeInTheDocument();
  });

  // D-22: at most 10 PDFs per Document.
  it('disables the upload once the Document holds 10 files', () => {
    render(Array.from({ length: 10 }, (_, i) => file({ id: `file-${i}` })));

    expect(screen.getByRole('button', { name: 'Carica PDF' })).toBeDisabled();
  });
});

describe('uploading', () => {
  it('sends a picked PDF', async () => {
    fetchMock.mockResolvedValue(rawDocumentFile());
    const { host, user } = render([]);
    const picked = pdf();

    await user.upload(uploadInput(host), picked);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(BASE);
    expect(init?.formData?.get('file')).toBe(picked);
  });

  it('stops a file that is not a PDF before sending it', async () => {
    const { host } = render([]);
    const input = uploadInput(host);
    // `user.upload` would drop it for not matching `accept`; a drop or an
    // "all files" pick doesn't.
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'mappa.png', { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('Si possono allegare solo file PDF'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the picker is closed without a file', async () => {
    const { host } = render([]);
    const input = uploadInput(host);
    Object.defineProperty(input, 'files', { value: [] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('shows the backend message when it refuses the file', async () => {
    fetchMock.mockRejectedValue(new Error('Il file non è un PDF'));
    const { host, user } = render([]);

    await user.upload(uploadInput(host), pdf());

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toEqual(new Error('Il file non è un PDF'));
  });
});

describe('opening', () => {
  it('opens the file through its signed link', async () => {
    vi.mocked(openPdf).mockResolvedValue();
    const { user } = render([file()], false);

    await user.click(screen.getByRole('button', { name: 'Apri Scheda di Aria.pdf' }));

    expect(openPdf).toHaveBeenCalledWith('https://storage.example/file-1.pdf?token=t&download=Scheda');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('says so when the file could not be opened', async () => {
    vi.mocked(openPdf).mockRejectedValue(new Error('expired'));
    const { user } = render([file()], false);

    await user.click(screen.getByRole('button', { name: 'Apri Scheda di Aria.pdf' }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('Impossibile aprire Scheda di Aria.pdf'),
    );
  });
});

describe('deleting', () => {
  it('asks first, then deletes', async () => {
    fetchMock.mockResolvedValue(undefined);
    const { user } = render([file()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Scheda di Aria.pdf' }));
    expect(screen.getByText(/"Scheda di Aria.pdf" verrà eliminato/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${BASE}/file-1`, { method: 'DELETE' }),
    );
  });

  it('does nothing when cancelled', async () => {
    const { user } = render([file()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Scheda di Aria.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    await waitFor(() => expect(screen.queryByText(/verrà eliminato/)).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes the confirmation on Escape', async () => {
    const { user } = render([file()]);

    await user.click(screen.getByRole('button', { name: 'Elimina Scheda di Aria.pdf' }));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText(/verrà eliminato/)).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks only the file being deleted as busy', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { user } = render([file(), file({ id: 'file-2', name: 'Mappa.pdf' })]);

    await user.click(screen.getByRole('button', { name: 'Elimina Scheda di Aria.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Elimina Scheda di Aria.pdf' })).toHaveAttribute(
        'data-loading',
      ),
    );
    expect(screen.getByRole('button', { name: 'Elimina Mappa.pdf' })).not.toHaveAttribute(
      'data-loading',
    );
  });
});
