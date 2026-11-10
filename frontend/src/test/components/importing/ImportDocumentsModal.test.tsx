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
      maps: [],
      skipped_maps: [],
      sections: [],
      skipped_sections: [],
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
  it('reads a picked folder as an Obsidian vault (spec 65)', async () => {
    const { user } = render();
    const note = new File(['x'], 'Jason.md');
    const picture = new File(['x'], 'pic.png');
    const folder = (await screen.findByTestId('import-folder-input')) as HTMLInputElement;

    await user.upload(folder, [note, picture]);

    expect(screen.getByRole('switch', { name: 'Vault di Obsidian' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Anteprima' }));
    await screen.findByText('1 Documento trovato');
    const sent = fetchMock.mock.calls.find(
      ([path]) => path === '/rooms/room-1/imports/preview',
    )![1] as {
      formData: FormData;
    };
    expect(sent.formData.getAll('files')).toHaveLength(2); // the note and its picture
    expect(sent.formData.get('obsidian')).toBe('true');
  });

  it('forces the Obsidian reader with the switch and passes it on to the import', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('switch', { name: 'Vault di Obsidian' }));
    await pickAndPreview(user);
    await screen.findByText('1 Documento trovato');
    await user.click(screen.getByRole('button', { name: 'Importa' }));
    await screen.findByText('Importazione completata');

    const upload = fetchMock.mock.calls.find(
      ([path, init]) =>
        path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )![1] as { formData: FormData };
    expect(upload.formData.get('obsidian')).toBe('true');
  });

  it('opens the folder picker from the folder button', async () => {
    const { user } = render();
    const folder = (await screen.findByTestId('import-folder-input')) as HTMLInputElement;
    const click = vi.spyOn(folder, 'click').mockImplementation(() => undefined);

    await user.click(screen.getByRole('button', { name: 'Scegli una cartella' }));

    expect(click).toHaveBeenCalled();
  });

  it('does nothing when a picked folder holds no Markdown note', async () => {
    const { user } = render();
    const folder = (await screen.findByTestId('import-folder-input')) as HTMLInputElement;

    await user.upload(folder, new File(['x'], 'pic.png'));

    expect(screen.getByRole('button', { name: 'Anteprima' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Vault di Obsidian' })).not.toBeChecked();
  });

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
      maps: [],
      sections: [],
      page_cards: [],
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
      maps: [],
      sections: [],
      page_cards: [],
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
        rawImportPreviewDocument({
          existing_document_id: 'doc-1',
          can_replace: true,
          matched_by_name: true,
        }),
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
    // Matched by name only (spec 69): the reason is shown, and only for that one.
    expect(screen.getAllByText('Stesso nome, id diverso')).toHaveLength(1);
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
      maps: [],
      sections: [],
      page_cards: [],
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

  it('lists the maps found, imports the ticked ones and links what was created (spec 40)', async () => {
    const map = (overrides: Record<string, unknown> = {}) => ({
      key: '0:map:0',
      file_name: 'stanza.json',
      name: 'Il Regno',
      kind: 'geographic',
      documents_count: 2,
      skipped: null,
      warnings: [],
      ...overrides,
    });
    api.preview = rawImportPreview({
      maps: [
        map({
          warnings: [
            { code: 'documents_left_out', count: 1, names: [] },
            { code: 'master_only_dropped', count: 2, names: [] },
            { code: 'selective_to_private', count: 1, names: [] },
          ],
        }),
        map({ key: '0:map:1', name: 'La Corte', kind: 'free', documents_count: 1 }),
        map({ key: '0:map:2', name: '', skipped: 'limit' }),
      ],
    });
    api.job = doneJob({
      maps: [{ id: 'map-new', name: 'Il Regno' }],
      skipped_maps: [{ name: '', reason: 'background' }],
    });
    const { user } = render();
    await pickAndPreview(user);

    expect(await screen.findByText('3 mappe trovate')).toBeInTheDocument();
    expect(screen.getByText('Mappa geografica · 2 Documenti sulla mappa')).toBeInTheDocument();
    expect(screen.getByText('Lavagna libera · 1 Documento sulla mappa')).toBeInTheDocument();
    expect(
      screen.getByText('1 carta o luogo di un Documento non importato viene tralasciato'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 elementi solo per il Master vengono tralasciati')).toBeInTheDocument();
    expect(screen.getByText('La visibilità Selettiva diventa Privata')).toBeInTheDocument();
    expect(screen.getByText('La stanza ha già il numero massimo di mappe')).toBeInTheDocument();
    const full = screen.getByRole('checkbox', { name: 'Importa la mappa Mappa senza nome' });
    expect(full).toBeDisabled();
    expect(full).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Importa la mappa La Corte' }));
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('1 mappa creata')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Il Regno' })).toHaveAttribute(
      'href',
      '/rooms/room-1/maps/map-new',
    );
    expect(screen.getByText('1 mappa non importata del tutto')).toBeInTheDocument();
    expect(
      screen.getByText("Mappa senza nome: Non è stato possibile importare l'immagine di sfondo"),
    ).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([path, init]) => path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )!;
    expect(JSON.parse((call[1] as { formData: FormData }).formData.get('choices') as string)).toEqual({
      selected: ['0:0'],
      replace: [],
      maps: ['0:map:0'],
      sections: [],
      page_cards: [],
    });
  });

  it('lists the Sections of the Room home, custom ones ticked and page cards not (spec 56)', async () => {
    const section = (overrides: Record<string, unknown> = {}) => ({
      key: '0:section:0',
      file_name: 'stanza.json',
      kind: 'custom',
      title: 'Tokyo',
      has_image: true,
      blocks_count: 2,
      skipped_blocks: 1,
      skipped: null,
      ...overrides,
    });
    api.preview = rawImportPreview({
      sections: [
        section({ key: '0:section:0', kind: 'page_documents', title: 'Archivio', blocks_count: 0, skipped_blocks: 0 }),
        section({ key: '0:section:1' }),
        section({ key: '0:section:2', title: 'Shibuya', has_image: false, blocks_count: 1, skipped_blocks: 0 }),
        section({ key: '0:section:3', title: null, skipped: 'invalid', skipped_blocks: 0 }),
        section({ key: '0:section:4', kind: 'page_maps', title: null, has_image: false, blocks_count: 0, skipped_blocks: 0 }),
      ],
    });
    api.job = doneJob({
      sections: [
        { id: 'section-new', kind: 'custom', title: 'Tokyo' },
        { id: 'section-maps', kind: 'page_maps', title: null },
      ],
      skipped_sections: [{ kind: 'custom', title: 'Tokyo', reason: 'image' }],
    });
    const { user } = render();
    await pickAndPreview(user);

    expect(await screen.findByText('5 Sezioni della Home della Stanza trovate')).toBeInTheDocument();
    expect(screen.getByText(/Le schede delle pagine non sono spuntate/)).toBeInTheDocument();
    expect(screen.getByText('2 blocchi · con immagine')).toBeInTheDocument();
    expect(screen.getByText('1 blocco')).toBeInTheDocument();
    expect(screen.getByText('Sovrascrive la scheda di questa Stanza · con immagine')).toBeInTheDocument();
    expect(screen.getByText('Sovrascrive la scheda di questa Stanza')).toBeInTheDocument();
    expect(screen.getByText(/1 blocco di Documenti viene tralasciato/)).toBeInTheDocument();
    expect(
      screen.getByText('Non si può importare: non è leggibile o non rispetta le regole della Home della Stanza'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Importa la Sezione Tokyo' })).toBeChecked();
    const archive = screen.getByRole('checkbox', { name: 'Applica Archivio alla scheda di questa Stanza' });
    expect(archive).not.toBeChecked();
    const invalid = screen.getByRole('checkbox', { name: 'Importa la Sezione Sezione senza titolo' });
    expect(invalid).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Importa la Sezione Shibuya' }));
    await user.click(screen.getByRole('checkbox', { name: 'Applica Mappe alla scheda di questa Stanza' }));
    await user.click(screen.getByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('2 Sezioni della Home della Stanza create o aggiornate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tokyo' })).toHaveAttribute(
      'href',
      '/rooms/room-1/sections/section-new',
    );
    expect(screen.getByRole('link', { name: 'Mappe' })).toHaveAttribute('href', '/rooms/room-1/maps');
    expect(screen.getByText('1 Sezione non importata del tutto')).toBeInTheDocument();
    expect(screen.getByText('Tokyo: Non è stato possibile importare la sua immagine')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([path, init]) => path === '/rooms/room-1/imports' && (init as { method?: string }).method === 'POST',
    )!;
    expect(JSON.parse((call[1] as { formData: FormData }).formData.get('choices') as string)).toEqual({
      selected: ['0:0'],
      replace: [],
      maps: [],
      sections: ['0:section:1'],
      page_cards: ['0:section:4'],
    });
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

  it('cannot import more than 2000 images of the ticked Documents (spec 59)', async () => {
    api.preview = rawImportPreview({
      documents: [
        rawImportPreviewDocument({ images_count: 1500 }),
        rawImportPreviewDocument({ key: '0:1', name: 'La Cripta', images_count: 600 }),
      ],
    });
    const { user } = render();
    await pickAndPreview(user);

    expect(
      await screen.findByText(
        'I Documenti spuntati hanno 2100 immagini: al massimo 2000 per importazione. Togline qualcuno e importa il resto dopo.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importa' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Importa La Cripta' }));
    expect(screen.getByText('1 Documento selezionato')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importa' })).toBeEnabled();
  });

  it('shows how far the images got, then how many came across (spec 59)', async () => {
    api.job = rawImportJob({ status: 'running', progress: { total: 450, stored: 118, done: 120 } });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('Immagini: 120 di 450')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Immagini importate finora' })).toBeInTheDocument();
    expect(
      screen.getByText('I Documenti sono già nella Room; le loro immagini compaiono man mano che arrivano.'),
    ).toBeInTheDocument();
  });

  it('says nothing of images for an import that has none', async () => {
    api.job = rawImportJob({ status: 'running', progress: { total: 0, stored: 0, done: 0 } });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('Importazione in corso…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('says nothing of images once done when there were none', async () => {
    api.job = doneJob({ images: { total: 0, stored: 0, done: 0 } });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('Importazione completata')).toBeInTheDocument();
    expect(screen.queryByText(/immagini importate/)).not.toBeInTheDocument();
  });

  it('says how many images came across once done', async () => {
    api.job = doneJob({ images: { total: 450, stored: 448, done: 0 } });
    const { user } = render();
    await pickAndPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Importa' }));

    expect(await screen.findByText('448 di 450 immagini importate')).toBeInTheDocument();
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
