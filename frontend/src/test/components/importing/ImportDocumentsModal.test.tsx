import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { rawImportJob, rawImportPreview, rawImportPreviewDocument } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { ImportDocumentsModal } from '../../../components/importing/ImportDocumentsModal';

vi.mock('../../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const onClose = vi.fn();
const fetchMock = vi.mocked(apiFetch);
const file = new File(['{"documents": []}'], 'stanza.json', { type: 'application/json' });

const doneJob = (result: Record<string, unknown> = {}) =>
  rawImportJob({
    status: 'done',
    finished_at: '2026-10-08T12:01:00Z',
    result: {
      created: [{ id: 'doc-new', name: 'Il Cancello' }],
      replaced: [],
      skipped: [],
      ...result,
    },
  });

interface Api {
  preview: unknown;
  job: unknown;
  started: unknown;
}
const api: Api = { preview: rawImportPreview(), job: doneJob(), started: rawImportJob() };

function mockApi() {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/imports/preview') return Promise.resolve(api.preview);
    if (path === '/rooms/room-1/imports' && init?.method === 'POST')
      return api.started instanceof Error ? Promise.reject(api.started) : Promise.resolve(api.started);
    if (path === '/rooms/room-1/imports/import-1') return Promise.resolve(api.job);
    return Promise.resolve([]);
  });
}

function render() {
  // The dialog stays mounted while closed, as in the Room's title actions.
  function Host() {
    const [opened, setOpened] = useState(true);
    return (
      <>
        <button onClick={() => setOpened(true)}>riapri</button>
        <ImportDocumentsModal
          opened={opened}
          onClose={() => {
            onClose();
            setOpened(false);
          }}
          roomId="room-1"
        />
      </>
    );
  }
  renderWithProviders(<Host />);
  return { user: userEvent.setup() };
}

async function pickAndPreview(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  await user.click(screen.getByRole('button', { name: 'Anteprima' }));
}

beforeEach(() => {
  fetchMock.mockReset();
  onClose.mockReset();
  api.preview = rawImportPreview();
  api.job = doneJob();
  api.started = rawImportJob();
  mockApi();
});

describe('ImportDocumentsModal (spec 27)', () => {
  it('previews, imports and shows the Documents it created as links', async () => {
    const { user } = render();

    expect(await screen.findByRole('dialog', { name: 'Importa Documenti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anteprima' })).toBeDisabled();
    await pickAndPreview(user);

    expect(await screen.findByText('1 Documento trovato')).toBeInTheDocument();
    expect(screen.getByText('2 Note · 1 immagine · Tag: PNG')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Importa Il Cancello' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    const link = await screen.findByRole('link', { name: 'Il Cancello' });
    expect(link).toHaveAttribute('href', '/rooms/room-1/documents/doc-new');
    expect(screen.getByText('Importazione completata')).toBeInTheDocument();
    expect(screen.getByText('1 Documento creato')).toBeInTheDocument();

    const upload = fetchMock.mock.calls.find(
      ([path, init]) => path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )![1] as { formData: FormData };
    expect(upload.formData.getAll('files')).toHaveLength(1);
    expect(JSON.parse(upload.formData.get('choices') as string)).toEqual({
      selected: ['0:0'],
      replace: [],
    });
  });

  it('leaves out what is unticked, and cannot import with nothing ticked', async () => {
    api.preview = rawImportPreview({
      documents: [
        rawImportPreviewDocument(),
        rawImportPreviewDocument({ key: '0:1', name: 'La Cripta' }),
      ],
    });
    const { user } = render();
    await pickAndPreview(user);

    await user.click(await screen.findByRole('checkbox', { name: 'Importa Il Cancello' }));
    expect(screen.getByText('1 Documento selezionato')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Importa La Cripta' }));
    expect(screen.getByRole('button', { name: 'Importa' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Importa La Cripta' }));
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    await screen.findByText('Importazione completata');
    const call = fetchMock.mock.calls.find(
      ([path, init]) => path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )!;
    expect(JSON.parse((call[1] as { formData: FormData }).formData.get('choices') as string)).toEqual({
      selected: ['0:1'],
      replace: [],
    });
  });

  it('says nothing of Tags for a Document that has none', async () => {
    api.preview = rawImportPreview({
      documents: [rawImportPreviewDocument({ tag_names: [], notes_count: 0, images_count: 0 })],
    });
    const { user } = render();

    await pickAndPreview(user);

    expect(await screen.findByText('0 Note · 0 immagini')).toBeInTheDocument();
  });

  it('shows what is dropped or changed and the Tags created or refused', async () => {
    api.preview = rawImportPreview({
      documents: [
        rawImportPreviewDocument({
          warnings: [
            { code: 'comments_dropped', count: 2, names: [] },
            { code: 'files_dropped', count: 1, names: [] },
            { code: 'player_dropped', count: 0, names: [] },
            { code: 'selective_to_private', count: 1, names: [] },
            { code: 'tags_not_created', count: 0, names: ['Boss'] },
          ],
        }),
      ],
      tags_to_create: [{ name: 'Fazione', category: null }],
      unavailable_tags: ['Boss'],
    });
    const { user } = render();
    await pickAndPreview(user);

    expect(await screen.findByText('2 Commenti non vengono importati')).toBeInTheDocument();
    expect(screen.getByText('1 allegato PDF non viene importato')).toBeInTheDocument();
    expect(screen.getByText('Il collegamento al giocatore non viene importato')).toBeInTheDocument();
    expect(
      screen.getByText('1 elemento con visibilità Selettiva diventa Privato'),
    ).toBeInTheDocument();
    expect(screen.getByText('Tag non creati: Boss')).toBeInTheDocument();
    expect(screen.getByText('Tag che verranno creati: Fazione')).toBeInTheDocument();
    expect(
      screen.getByText('Tag che non puoi creare e che verranno tolti: Boss'),
    ).toBeInTheDocument();
  });

  it('asks Copy or Replace for Documents that already exist, Replace only where allowed', async () => {
    api.preview = rawImportPreview({
      documents: [
        rawImportPreviewDocument({ existing_document_id: 'doc-1', can_replace: true }),
        rawImportPreviewDocument({
          key: '0:1',
          name: 'La Cripta',
          existing_document_id: 'doc-2',
          can_replace: false,
        }),
        rawImportPreviewDocument({ key: '0:2', name: 'Nuovo' }),
      ],
    });
    const { user } = render();
    await pickAndPreview(user);

    expect(await screen.findAllByText('Esiste già in questa Stanza')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Avanti' }));

    expect(await screen.findByText('Alcuni Documenti esistono già')).toBeInTheDocument();
    // The new Document is not asked about.
    expect(screen.queryByRole('radiogroup', { name: 'Cosa fare con Nuovo' })).not.toBeInTheDocument();
    const cancello = screen.getByRole('radiogroup', { name: 'Cosa fare con Il Cancello' });
    expect(within(cancello).getByRole('radio', { name: 'Copia' })).toBeChecked();
    const cripta = screen.getByRole('radiogroup', { name: 'Cosa fare con La Cripta' });
    expect(within(cripta).getByRole('radio', { name: 'Sostituisci' })).toBeDisabled();
    expect(
      screen.getByText('Solo un Owner del Documento (o il Master) può sostituirlo'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sostituisci tutti' }));
    expect(within(cancello).getByRole('radio', { name: 'Sostituisci' })).toBeChecked();
    expect(within(cripta).getByRole('radio', { name: 'Copia' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Copia tutti' }));
    expect(within(cancello).getByRole('radio', { name: 'Copia' })).toBeChecked();
    await user.click(within(cancello).getByText('Sostituisci'));
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    await screen.findByText('Importazione completata');
    const call = fetchMock.mock.calls.find(
      ([path, init]) => path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )!;
    expect(JSON.parse((call[1] as { formData: FormData }).formData.get('choices') as string)).toEqual({
      selected: ['0:0', '0:1', '0:2'],
      replace: ['0:0'],
    });
  });

  it('goes back from the choices to the list', async () => {
    api.preview = rawImportPreview({
      documents: [rawImportPreviewDocument({ existing_document_id: 'doc-1', can_replace: true })],
    });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Avanti' }));

    await user.click(await screen.findByRole('button', { name: 'Indietro' }));
    expect(await screen.findByText('1 Documento trovato')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('button', { name: 'Anteprima' })).toBeInTheDocument();
  });

  it('says what the backend refused in the preview, and stays on the files', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/preview')
        ? Promise.reject(new ApiError(422, 'stanza.json non è leggibile'))
        : Promise.resolve([]),
    );
    const { user } = render();

    await pickAndPreview(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('stanza.json non è leggibile');
    expect(screen.getByRole('button', { name: 'Anteprima' })).toBeInTheDocument();
  });

  it('says what the backend refused when starting, such as an import already running', async () => {
    api.started = new ApiError(409, 'Hai già un\'importazione in corso in questa Room');
    const { user } = render();
    await pickAndPreview(user);

    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('importazione in corso');
    expect(screen.getByRole('button', { name: 'Importa' })).toBeInTheDocument();
  });

  it('lists the images that were skipped and why', async () => {
    api.job = doneJob({
      replaced: [{ id: 'doc-old', name: 'La Cripta' }],
      skipped: [
        {
          kind: 'image',
          document_id: 'doc-new',
          document_name: 'Il Cancello',
          url: 'https://x.test/a.png',
          reason: 'unreachable',
        },
        {
          kind: 'image',
          document_id: 'doc-new',
          document_name: 'Il Cancello',
          url: 'https://x.test/b.png',
          reason: 'limit',
        },
      ],
    });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('2 immagini non importate')).toBeInTheDocument();
    expect(screen.getByText('Il Cancello: link non raggiungibile o scaduto')).toBeInTheDocument();
    expect(
      screen.getByText('Il Cancello: il Documento ha già il massimo di immagini'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 Documento sostituito')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'La Cripta' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-old',
    );
  });

  it('shows a failed import and starts over with "Importa altri file"', async () => {
    api.job = rawImportJob({ status: 'failed', finished_at: '2026-10-08T12:01:00Z' });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('L\'importazione non è riuscita');
    await user.click(screen.getByRole('button', { name: 'Importa altri file' }));

    expect(await screen.findByRole('button', { name: 'Anteprima' })).toBeDisabled();
  });

  it('keeps a running import going when the dialog is closed, and shows it again', async () => {
    api.job = rawImportJob({ status: 'running' });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('Importazione in corso…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'riapri' }));

    expect(await screen.findByText('Importazione in corso…')).toBeInTheDocument();
  });

  it('forgets a finished import when the dialog is closed', async () => {
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));
    await screen.findByText('Importazione completata');

    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'riapri' }));

    expect(await screen.findByRole('button', { name: 'Anteprima' })).toBeInTheDocument();
  });

  it('can be cancelled before anything is read', async () => {
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Annulla' }));

    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
