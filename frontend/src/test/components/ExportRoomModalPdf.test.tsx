import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportRoomModal } from '../../components/ExportRoomModal';
import { ViewAsContext } from '../../hooks/useViewAs';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { notifyError } from '../../lib/notify';
import { setViewAsUser } from '../../lib/viewAs';
import { rawDocument, rawPdfJob, rawRoom } from '../fixtures';
import { renderWithProviders } from '../utils';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
// The signed-in user, or null to see the dialog before a session is known.
let signedInAs: string | null = 'user-1';
vi.mock('../../hooks/useSession', () => ({
  useSession: () => ({ session: signedInAs ? { user: { id: signedInAs } } : null, loading: false }),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const onClose = vi.fn();

const rawTags = [
  { id: 'npc', name: 'NPC', category: 'Type', main_position: 0 },
  { id: 'place', name: 'Luogo', category: null, main_position: null },
];

// What `GET .../exports` answers: `jobs` from the start, or `afterStart` once the
// PDF has been requested (the backend lists the job as soon as it is created).
let jobs: unknown[] = [];
let afterStart: unknown[] | null = null;
let started = false;

function render(wrapper?: Parameters<typeof renderWithProviders>[1]) {
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
  renderWithProviders(<Host />, wrapper);
  return { user: userEvent.setup() };
}

const posted = () =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(([path]) => path === '/rooms/room-1/exports/pdf')
    .map(([, init]) => init as { method: string; json: Record<string, unknown> });

beforeEach(() => {
  signedInAs = 'user-1';
  jobs = [];
  afterStart = null;
  started = false;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(notifyError).mockReset();
  onClose.mockReset();
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/rooms/room-1') return Promise.resolve(rawRoom());
    if (path === '/rooms/room-1/tags') return Promise.resolve(rawTags);
    if (path === '/rooms/room-1/documents') {
      return Promise.resolve([
        rawDocument({ id: 'gate', name: 'Il Cancello' }),
        rawDocument({ id: 'bare', name: 'Nuda', images: [] }),
      ]);
    }
    if (path === '/rooms/room-1/exports') {
      return Promise.resolve(started && afterStart ? afterStart : jobs);
    }
    if (path === '/rooms/room-1/exports/pdf') {
      started = true;
      return Promise.resolve(rawPdfJob());
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  setViewAsUser(null);
  localStorage.clear();
});

async function choosePdf(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('dialog', { name: 'Esporta la Stanza' });
  await user.click(screen.getByText('PDF'));
}

const generate = () => screen.getByRole('button', { name: 'Genera PDF' });

describe('ExportRoomModal, PDF format (spec 23b Frontend)', () => {
  it('offers the PDF after Markdown and JSON, with its own options and hint', async () => {
    const { user } = render();

    await choosePdf(user);

    expect(screen.getByRole('radio', { name: 'PDF' })).toBeChecked();
    expect(screen.getByText(/Un manuale impaginato/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Gotico/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'A4' })).toBeChecked();
    expect(screen.getByText(/resta disponibile per 24 ore/)).toBeInTheDocument();
    // The one-hour link note belongs to the files, not to the PDF.
    expect(screen.queryByText(/scadono entro un'ora/)).not.toBeInTheDocument();
  });

  it('asks for nothing PDF-related while another format is chosen', async () => {
    render();

    await screen.findByRole('dialog');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1'));
    expect(apiFetch).not.toHaveBeenCalledWith('/rooms/room-1/exports', expect.anything());
    expect(apiFetch).not.toHaveBeenCalledWith('/rooms/room-1/documents');
  });

  it('starts the PDF with the chosen options and Tag filter, then follows it until it is ready', async () => {
    const { user } = render();
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());

    await user.click(screen.getByRole('radio', { name: /Stampa/ }));
    await user.click(screen.getByText('Letter'));
    await user.click(screen.getByRole('checkbox', { name: 'Includi i Commenti in appendice' }));
    await user.click(screen.getByRole('combobox', { name: 'Immagine di copertina' }));
    await user.click(await screen.findByRole('option', { name: 'Il Cancello' }));
    await user.click(screen.getByRole('combobox', { name: /Solo i Documenti con questi Tag/ }));
    await user.click(await screen.findByRole('option', { name: '#NPC' }));
    afterStart = [rawPdfJob({ status: 'running' })];
    await user.click(generate());

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].method).toBe('POST');
    expect(posted()[0].json).toEqual({
      style: 'print',
      page_size: 'Letter',
      include_comments: true,
      include_attachments: false,
      cover_document_id: 'gate',
      room_cover: true,
      tag_ids: ['npc'],
      view_as_user_id: null,
    });

    // The list now holds the job, running: the dialog follows it.
    expect(await screen.findByText('Sto preparando il PDF…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Genera PDF' })).not.toBeInTheDocument();

    // Closing leaves it to the Room page.
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the download link of a finished job and remembers that it was taken', async () => {
    const { user } = render();
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());
    afterStart = [
      rawPdfJob({
        status: 'done',
        finished_at: '2026-10-05T12:01:00Z',
        expires_at: '2026-10-06T12:01:00Z',
        download_url: 'https://signed.test/exports/a.pdf?download=sala.pdf',
      }),
    ];
    await user.click(generate());

    const link = await screen.findByRole('link', { name: 'Scarica il PDF' });
    expect(link).toHaveAttribute('href', 'https://signed.test/exports/a.pdf?download=sala.pdf');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);

    expect(JSON.parse(localStorage.getItem('pdfDismissed:user-1:room-1') ?? '[]')).toEqual(['job-1']);
  });

  it('still follows and remembers a download when no session is known yet', async () => {
    signedInAs = null;
    const { user } = render();
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());
    afterStart = [rawPdfJob({ status: 'done', download_url: 'https://signed.test/a.pdf' })];
    await user.click(generate());

    const link = await screen.findByRole('link', { name: 'Scarica il PDF' });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);

    expect(JSON.parse(localStorage.getItem('pdfDismissed::room-1') ?? '[]')).toEqual(['job-1']);
  });

  it('goes back to the form for another PDF once the job is over', async () => {
    const { user } = render();
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());
    afterStart = [rawPdfJob({ status: 'failed' })];
    await user.click(generate());

    expect(await screen.findByRole('alert')).toHaveTextContent('Non è stato possibile');
    afterStart = [];
    await user.click(screen.getByRole('button', { name: 'Riprova' }));

    expect(await screen.findByRole('button', { name: 'Genera PDF' })).toBeInTheDocument();
  });

  it('picks up a PDF still being made from an earlier visit instead of starting a second', async () => {
    jobs = [rawPdfJob({ id: 'earlier', status: 'queued' })];
    const { user } = render();

    await choosePdf(user);

    expect(await screen.findByText('Sto preparando il PDF…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Genera PDF' })).not.toBeInTheDocument();
  });

  it('shows the backend message and stays on the form when the PDF cannot be started', async () => {
    const error = new ApiError(409, 'Stai già generando un PDF in questa Room');
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/rooms/room-1/exports/pdf') return Promise.reject(error);
      if (path === '/rooms/room-1') return Promise.resolve(rawRoom());
      if (path === '/rooms/room-1/exports') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const { user } = render();
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());

    await user.click(generate());

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);
    expect(generate()).toBeInTheDocument();
  });

  it('makes the PDF as the member being previewed, named in the body and not in the header (spec 22b)', async () => {
    setViewAsUser('alice');
    const { user } = render({
      wrapper: ({ children }) => (
        <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'alice' }}>
          {children}
        </ViewAsContext.Provider>
      ),
    });
    await choosePdf(user);
    await waitFor(() => expect(generate()).toBeEnabled());

    expect(screen.getByText(/come un altro membro/)).toBeInTheDocument();
    await user.click(generate());

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].json.view_as_user_id).toBe('alice');
    expect(posted()[0]).toEqual(
      expect.objectContaining({ ignoreViewAs: true } as Record<string, unknown>),
    );
  });

  it('cannot be started before the Room is known', async () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => undefined));
    const { user } = render();

    await choosePdf(user);

    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Genera PDF' })).toBeDisabled();
  });
});
