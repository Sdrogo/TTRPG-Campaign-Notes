import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { renderWithProviders } from '../utils';
import { ImageSearchModal } from '../../components/ImageSearchModal';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function rawResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'img-1',
    thumbnail_url: 'https://api.openverse.org/v1/images/img-1/thumb/',
    url: 'https://example.com/castle.jpg',
    width: 800,
    height: 600,
    title: 'Castello',
    creator: 'Ada',
    license: 'CC BY 2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    source_url: 'https://example.com/castle',
    ...overrides,
  };
}

function render(props: { addingUrl?: string | null } = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <ImageSearchModal
      opened
      onClose={onClose}
      roomId="room-1"
      documentId="doc-1"
      onAdd={onAdd}
      addingUrl={props.addingUrl ?? null}
    />,
  );
  return { onAdd, onClose, user: userEvent.setup() };
}

async function search(user: ReturnType<typeof userEvent.setup>, text = 'castello') {
  await user.type(screen.getByRole('textbox', { name: 'Cosa cercare' }), `${text}{Enter}`);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('ImageSearchModal (spec 29)', () => {
  it('searches only on submit, with the query tidied', async () => {
    fetchMock.mockResolvedValue({ results: [rawResult()], page: 1, has_more: false });
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: 'Cosa cercare' }), '  vecchio   castello ');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cerca' }));

    expect(await screen.findByRole('button', { name: 'Aggiungi Castello' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/documents/doc-1/image-search?q=vecchio+castello&page=1',
    );
  });

  it('cannot search an empty query', () => {
    render();

    expect(screen.getByRole('button', { name: 'Cerca' })).toBeDisabled();
  });

  it('shows the thumbnail from Openverse and the credit linking to the source', async () => {
    fetchMock.mockResolvedValue({ results: [rawResult()], page: 1, has_more: false });
    const { user } = render();
    await search(user);

    const add = await screen.findByRole('button', { name: 'Aggiungi Castello' });
    expect(add.querySelector('img')).toHaveAttribute(
      'src',
      'https://api.openverse.org/v1/images/img-1/thumb/',
    );
    const link = screen.getByRole('link', { name: 'Ada · CC BY 2.0' });
    expect(link).toHaveAttribute('href', 'https://example.com/castle');
    expect(link).toHaveAttribute('target', '_blank');

    await user.hover(add);
    expect(await screen.findByText('Castello · Ada · CC BY 2.0')).toBeInTheDocument();
  });

  it('copes with results missing their credit', async () => {
    fetchMock.mockResolvedValue({
      results: [
        rawResult({ id: 'a', title: null, creator: null, license: null }),
        rawResult({ id: 'b', title: 'Mappa', creator: null, license: null, source_url: null }),
      ],
      page: 1,
      has_more: false,
    });
    const { user } = render();
    await search(user);

    const untitled = await screen.findByRole('button', { name: 'Aggiungi Senza titolo' });
    expect(screen.getByRole('link', { name: 'Fonte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi Mappa' })).toBeInTheDocument();

    await user.hover(untitled);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Senza titolo');
  });

  it('adds a clicked image and marks it added once done', async () => {
    fetchMock.mockResolvedValue({ results: [rawResult()], page: 1, has_more: false });
    const { onAdd, user } = render();
    await search(user);

    const add = await screen.findByRole('button', { name: 'Aggiungi Castello' });
    await user.click(add);

    expect(onAdd).toHaveBeenCalledWith('https://example.com/castle.jpg', expect.any(Function));
    expect(screen.queryByText('Aggiunta')).not.toBeInTheDocument();
    act(() => onAdd.mock.calls[0][1]());
    expect(screen.getByText('Aggiunta')).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  it('shows which image is being added and blocks the others meanwhile', async () => {
    fetchMock.mockResolvedValue({
      results: [rawResult(), rawResult({ id: 'img-2', title: 'Torre', url: 'https://example.com/t.jpg' })],
      page: 1,
      has_more: false,
    });
    const { user } = render({ addingUrl: 'https://example.com/castle.jpg' });
    await search(user);

    expect(await screen.findByRole('button', { name: 'Aggiungi Torre' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aggiungi Castello' })).toBeDisabled();
  });

  it('says when nothing was found', async () => {
    fetchMock.mockResolvedValue({ results: [], page: 1, has_more: false });
    const { user } = render();
    await search(user);

    expect(await screen.findByText('Nessuna immagine trovata')).toBeInTheDocument();
  });

  it("shows the backend's message when the search fails", async () => {
    fetchMock.mockRejectedValue(
      new ApiError(502, 'La ricerca di immagini non è disponibile ora, riprova più tardi'),
    );
    const { user } = render();
    await search(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La ricerca di immagini non è disponibile ora',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads more results onto the grid', async () => {
    fetchMock
      .mockResolvedValueOnce({ results: [rawResult()], page: 1, has_more: true })
      .mockResolvedValueOnce({
        results: [rawResult({ id: 'img-2', title: 'Torre' })],
        page: 2,
        has_more: false,
      });
    const { user } = render();
    await search(user);

    await user.click(await screen.findByRole('button', { name: 'Altri risultati' }));

    expect(await screen.findByRole('button', { name: 'Aggiungi Torre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi Castello' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/rooms/room-1/documents/doc-1/image-search?q=castello&page=2',
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Altri risultati' })).not.toBeInTheDocument(),
    );
  });

  it('shows a loader while searching', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { user } = render();
    await search(user);

    expect(await screen.findByLabelText('Ricerca in corso')).toBeInTheDocument();
  });
});
