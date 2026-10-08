import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../utils';
import { AddDocumentImages } from '../../components/AddDocumentImages';

function render(props: Partial<Parameters<typeof AddDocumentImages>[0]> = {}) {
  const onUploadFiles = vi.fn();
  const onImportUrl = vi.fn();
  const onSearch = vi.fn();
  renderWithProviders(
    <AddDocumentImages
      onUploadFiles={onUploadFiles}
      uploading={false}
      onImportUrl={onImportUrl}
      importing={false}
      onSearch={onSearch}
      {...props}
    />,
  );
  return { onUploadFiles, onImportUrl, onSearch, user: userEvent.setup() };
}

const urlField = () => screen.getByPlaceholderText("https://… URL dell'immagine");
const openUrl = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Da URL' }));

describe('AddDocumentImages', () => {
  // A compact row, like the PDFs' "File" one in the info panel.
  it('is a titled row offering both ways to add an image', () => {
    render();

    expect(screen.getByText('Immagini')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carica immagini/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Da URL' })).toBeInTheDocument();
  });

  it('names the accepted formats on the upload button', async () => {
    const { user } = render();

    await user.hover(screen.getByRole('button', { name: /Carica immagini/ }));

    expect(await screen.findByText(/PNG, JPEG, WebP o GIF/)).toBeInTheDocument();
  });

  it('cannot import while the URL field is empty', async () => {
    const { user } = render();
    await openUrl(user);

    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toBeDisabled();
  });

  // The backend's SSRF guard only fetches http(s).
  it('rejects a non-http(s) URL', async () => {
    const { user } = render();
    await openUrl(user);

    await user.type(urlField(), 'file:///etc/passwd');

    expect(screen.getByText('Inserisci un URL http(s) valido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toBeDisabled();
  });

  it('imports a trimmed URL', async () => {
    const { onImportUrl, user } = render();
    await openUrl(user);

    await user.type(urlField(), '  https://example.com/map.png  ');
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    expect(onImportUrl).toHaveBeenCalledWith('https://example.com/map.png', expect.any(Function));
  });

  it('imports on Enter, but not an invalid URL', async () => {
    const { onImportUrl, user } = render();
    await openUrl(user);

    await user.type(urlField(), 'not a url{Enter}');
    expect(onImportUrl).not.toHaveBeenCalled();

    await user.clear(urlField());
    await user.type(urlField(), 'https://example.com/map.png{Enter}');
    expect(onImportUrl).toHaveBeenCalledWith('https://example.com/map.png', expect.any(Function));
  });

  // The field is cleared by the callback, not on click: it must survive a
  // failed import so the user can retry without retyping.
  it('clears the field only when the import reports success', async () => {
    const { onImportUrl, user } = render();
    await openUrl(user);
    await user.type(urlField(), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    expect(urlField()).toHaveValue('https://example.com/map.png');

    act(() => onImportUrl.mock.calls[0][1]());
    await openUrl(user);
    expect(urlField()).toHaveValue('');
  });

  it('uploads picked files', async () => {
    const { onUploadFiles, user } = render();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(['bytes'], 'mappa.png', { type: 'image/png' }));

    expect(onUploadFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'mappa.png' })]);
  });

  // The picker fires onChange with no files on a cancelled dialog too.
  it('does nothing when the file dialog is cancelled', () => {
    const { onUploadFiles } = render();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('shows the upload in progress', () => {
    render({ uploading: true });

    expect(screen.getByRole('button', { name: /Carica immagini/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
  });

  it('shows the import in progress', async () => {
    const { user } = render({ importing: true });
    await openUrl(user);

    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toHaveAttribute(
      'data-loading',
      'true',
    );
  });

  it('opens the image search', async () => {
    const { onSearch, user } = render();

    await user.click(screen.getByRole('button', { name: 'Cerca immagini' }));

    expect(onSearch).toHaveBeenCalled();
  });
});
