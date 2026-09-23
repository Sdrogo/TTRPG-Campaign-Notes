import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { AddDocumentImages } from './AddDocumentImages';

function render(props: Partial<Parameters<typeof AddDocumentImages>[0]> = {}) {
  const onUploadFiles = vi.fn();
  const onImportUrl = vi.fn();
  renderWithProviders(
    <AddDocumentImages
      onUploadFiles={onUploadFiles}
      uploading={false}
      onImportUrl={onImportUrl}
      importing={false}
      {...props}
    />,
  );
  return { onUploadFiles, onImportUrl, user: userEvent.setup() };
}

const urlField = () => screen.getByPlaceholderText("https://… URL dell'immagine");

describe('AddDocumentImages', () => {
  it('offers both ways to add an image', () => {
    render();

    expect(screen.getByRole('button', { name: /Dal computer/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toBeInTheDocument();
  });

  it('names the accepted formats', () => {
    render();

    expect(screen.getByText(/PNG, JPEG, WebP o GIF/)).toBeInTheDocument();
  });

  it('cannot import while the URL field is empty', () => {
    render();

    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toBeDisabled();
  });

  // The backend's SSRF guard only fetches http(s).
  it('rejects a non-http(s) URL', async () => {
    const { user } = render();

    await user.type(urlField(), 'file:///etc/passwd');

    expect(screen.getByText('Inserisci un URL http(s) valido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toBeDisabled();
  });

  it('imports a trimmed URL', async () => {
    const { onImportUrl, user } = render();

    await user.type(urlField(), '  https://example.com/map.png  ');
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    expect(onImportUrl).toHaveBeenCalledWith('https://example.com/map.png', expect.any(Function));
  });

  // The field is cleared by the callback, not on click: it must survive a
  // failed import so the user can retry without retyping.
  it('clears the field only when the import reports success', async () => {
    const { onImportUrl, user } = render();
    await user.type(urlField(), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi da URL' }));

    expect(urlField()).toHaveValue('https://example.com/map.png');

    act(() => onImportUrl.mock.calls[0][1]());
    expect(urlField()).toHaveValue('');
  });

  it('uploads picked files', async () => {
    const { onUploadFiles, user } = render();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(['bytes'], 'mappa.png', { type: 'image/png' }));

    expect(onUploadFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'mappa.png' })]);
  });

  it('shows the upload in progress', () => {
    render({ uploading: true });

    expect(screen.getByRole('button', { name: /Dal computer/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
  });

  it('shows the import in progress', () => {
    render({ importing: true });

    expect(screen.getByRole('button', { name: 'Aggiungi da URL' })).toHaveAttribute(
      'data-loading',
      'true',
    );
  });
});
