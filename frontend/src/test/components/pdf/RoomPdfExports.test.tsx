import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { RoomPdfExports } from '../../../components/pdf/RoomPdfExports';
import { rawPdfJob } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render(jobs: unknown[]) {
  fetchMock.mockResolvedValue(jobs);
  renderWithProviders(<RoomPdfExports roomId="room-1" userId="user-1" />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('RoomPdfExports', () => {
  it('shows nothing when there is no PDF to follow or take', async () => {
    render([rawPdfJob({ id: 'old', status: 'expired' })]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'I tuoi PDF' })).not.toBeInTheDocument();
  });

  it('follows a PDF that is being made, with no way to hide it yet', async () => {
    render([rawPdfJob({ status: 'running', style: 'modern', page_size: 'Letter' })]);

    const list = await screen.findByRole('region', { name: 'I tuoi PDF' });
    expect(list).toHaveTextContent('Moderno · Letter');
    expect(list).toHaveTextContent('In preparazione');
    expect(screen.queryByRole('button', { name: /Nascondi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('lists a ready PDF until it is downloaded, then stops listing it', async () => {
    const { user } = render([
      rawPdfJob({
        status: 'done',
        download_url: 'https://signed.test/exports/a.pdf?download=sala.pdf',
      }),
    ]);

    const link = await screen.findByRole('link', { name: 'Scarica il PDF Gotico · A4' });
    expect(link).toHaveAttribute('href', 'https://signed.test/exports/a.pdf?download=sala.pdf');
    expect(screen.getByText('Pronto')).toBeInTheDocument();

    // Storage serves it as an attachment: stop jsdom from "navigating" on click.
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'I tuoi PDF' })).not.toBeInTheDocument(),
    );
    expect(JSON.parse(localStorage.getItem('pdfDismissed:user-1:room-1') ?? '[]')).toEqual(['job-1']);
  });

  it('keeps a failed PDF until it is hidden', async () => {
    const { user } = render([rawPdfJob({ status: 'failed' })]);

    expect(await screen.findByText('Non riuscito')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nascondi il PDF Gotico · A4' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'I tuoi PDF' })).not.toBeInTheDocument(),
    );
  });

  it('does not list a ready PDF as taken when its link is not available yet', async () => {
    render([rawPdfJob({ status: 'done', download_url: null })]);

    expect(await screen.findByText('Pronto')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nascondi/ })).toBeInTheDocument();
  });

  it('does not list what was hidden in an earlier visit', async () => {
    localStorage.setItem('pdfDismissed:user-1:room-1', '["job-1"]');
    render([rawPdfJob({ status: 'failed' })]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'I tuoi PDF' })).not.toBeInTheDocument();
  });
});
