import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toPdfJob, type PdfJob } from '../../../lib/pdfExport';
import { PdfJobPanel } from '../../../components/pdf/PdfJobPanel';
import { rawPdfJob } from '../../fixtures';
import { renderWithProviders } from '../../utils';

const job = (overrides: Record<string, unknown> = {}): PdfJob =>
  toPdfJob(rawPdfJob(overrides) as Parameters<typeof toPdfJob>[0]);

function render(pdfJob: PdfJob) {
  const onDownload = vi.fn();
  const onNew = vi.fn();
  renderWithProviders(<PdfJobPanel job={pdfJob} onDownload={onDownload} onNew={onNew} />);
  return { user: userEvent.setup(), onDownload, onNew };
}

describe('PdfJobPanel', () => {
  it.each(['queued', 'running'])(
    'says it is being made while %s, and that the window can be closed',
    (status) => {
      render(job({ status }));

      expect(screen.getByRole('status')).toHaveTextContent('Sto preparando il PDF');
      expect(screen.getByText(/Puoi chiudere questa finestra/)).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('offers the signed link once done, with the day it is removed, and reports the download', async () => {
    const { user, onDownload } = render(
      job({
        status: 'done',
        finished_at: '2026-10-05T12:01:00Z',
        expires_at: '2026-10-06T12:01:00Z',
        download_url: 'https://signed.test/exports/a.pdf?token=t&download=sala.pdf',
      }),
    );

    expect(screen.getByText('Il PDF è pronto.')).toBeInTheDocument();
    expect(screen.getByText(/Disponibile fino a/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Scarica il PDF' });
    expect(link).toHaveAttribute('href', 'https://signed.test/exports/a.pdf?token=t&download=sala.pdf');

    // Storage serves it as an attachment: stop jsdom from "navigating" on click.
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onDownload).toHaveBeenCalledWith('job-1');
  });

  it('waits for the link when the file is done but the link could not be signed yet', () => {
    render(job({ status: 'done', expires_at: '2026-10-06T12:01:00Z', download_url: null }));

    expect(screen.getByRole('status')).toHaveTextContent('Preparo il link di download');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not promise a day when none is known', () => {
    render(job({ status: 'done', download_url: 'https://signed.test/a.pdf' }));

    expect(screen.queryByText(/Disponibile fino a/)).not.toBeInTheDocument();
  });

  it('goes back to the form for another PDF', async () => {
    const { user, onNew } = render(job({ status: 'done', download_url: 'https://x/a.pdf' }));

    await user.click(screen.getByRole('button', { name: 'Prepara un altro PDF' }));

    expect(onNew).toHaveBeenCalled();
  });

  it('says it failed and offers to try again', async () => {
    const { user, onNew } = render(job({ status: 'failed' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Non è stato possibile preparare il PDF');
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('says a file past its day is gone', () => {
    render(job({ status: 'expired' }));

    expect(screen.getByText(/non è più disponibile/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
