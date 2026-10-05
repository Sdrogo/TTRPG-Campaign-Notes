import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PDF_OPTIONS } from '../../../lib/pdfExport';
import type { Document } from '../../../types/document';
import { PdfExportForm, type PdfFormValue } from '../../../components/pdf/PdfExportForm';
import { renderWithProviders } from '../../utils';

const documents = [
  { id: 'gate', name: 'Il Cancello', images: [{ id: 'i', url: 'u', isFavorite: true }] },
  { id: 'bare', name: 'Senza immagini', images: [] },
] as unknown as Document[];

function render(onChange = vi.fn()) {
  function Host() {
    const [value, setValue] = useState<PdfFormValue>(DEFAULT_PDF_OPTIONS);
    return (
      <PdfExportForm
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        documents={documents}
      />
    );
  }
  renderWithProviders(<Host />);
  return { user: userEvent.setup(), onChange };
}

describe('PdfExportForm', () => {
  it('starts from Gothic, A4 and nothing optional, with Gothic offered first', () => {
    render();

    const styles = screen.getAllByRole('radio').slice(0, 3);
    expect(styles.map((radio) => radio.closest('[role="radio"]')?.textContent)).toEqual([
      expect.stringContaining('Gotico'),
      expect.stringContaining('Moderno'),
      expect.stringContaining('Stampa'),
    ]);
    expect(screen.getByRole('radio', { name: /Gotico/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'A4' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Includi i Commenti in appendice' })).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Aggiungi in coda gli allegati PDF' }),
    ).not.toBeChecked();
  });

  it('changes the style, the page size and both switches', async () => {
    const { user, onChange } = render();

    await user.click(screen.getByRole('radio', { name: /Moderno/ }));
    await user.click(screen.getByText('Letter'));
    await user.click(screen.getByRole('checkbox', { name: 'Includi i Commenti in appendice' }));
    await user.click(screen.getByRole('checkbox', { name: 'Aggiungi in coda gli allegati PDF' }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        style: 'modern',
        pageSize: 'Letter',
        includeComments: true,
        includeAttachments: true,
        coverDocumentId: null,
      }),
    );
  });

  it('offers as cover only the Documents that have an image, and can clear it', async () => {
    const { user, onChange } = render();

    await user.click(screen.getByRole('combobox', { name: 'Immagine di copertina' }));
    expect(screen.getByRole('option', { name: 'Il Cancello' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Senza immagini' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Il Cancello' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ coverDocumentId: 'gate' }),
    );

    // Mantine hides the clear button from the accessibility tree (it is not a tab stop).
    const clear = screen.getByLabelText("Togli l'immagine di copertina", { selector: 'button' });
    await user.click(clear);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coverDocumentId: null }));
  });
});
