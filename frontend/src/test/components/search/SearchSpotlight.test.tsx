import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { renderWithProviders } from '../../utils';
import { SearchSpotlight } from '../../../components/search/SearchSpotlight';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const empty = { items: [], has_more: false };

function rawHit(kind: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind,
    id,
    document_id: kind === 'tag' ? null : 'doc-1',
    document_name: kind === 'tag' ? null : 'Il Castello',
    title: null,
    excerpt: null,
    ...overrides,
  };
}

const results = {
  documents: {
    items: [
      rawHit('document', 'doc-1', {
        title: { text: 'Il Castello del Drago', highlights: [[16, 21]] },
        excerpt: { text: 'Sulla collina.', highlights: [] },
      }),
    ],
    has_more: true,
  },
  notes: {
    items: [
      rawHit('note', 'note-1', {
        title: { text: 'Voci', highlights: [] },
        excerpt: { text: 'Un drago dorme', highlights: [[3, 8]] },
      }),
    ],
    has_more: false,
  },
  comments: {
    items: [rawHit('comment', 'c-1', { excerpt: { text: 'Drago!', highlights: [[0, 5]] } })],
    has_more: false,
  },
  tags: empty,
};

let searchResponse: unknown = results;

function mockApi() {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/rooms/room-1/tags') {
      return [{ id: 'tag-1', name: 'PNG', category: null }];
    }
    return searchResponse;
  });
}

/** Where the app went, so a test can assert the link a result followed. */
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function render(onClose = vi.fn()) {
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <SearchSpotlight roomId="room-1" opened onClose={onClose} />
            <Location />
          </>
        }
      />
    </Routes>,
    { route: '/rooms/room-1/documents' },
  );
  return { user: userEvent.setup(), onClose };
}

const searchInput = () => screen.getByRole('combobox', { name: 'Cerca nella Stanza' });

const searchCalls = () =>
  fetchMock.mock.calls.map(([path]) => path).filter((path) => path.includes('/search'));

beforeEach(() => {
  fetchMock.mockReset();
  searchResponse = results;
  mockApi();
});

describe('SearchSpotlight', () => {
  it('asks for two letters before searching', async () => {
    const { user } = render();

    expect(screen.getByText('Scrivi almeno 2 lettere.')).toBeInTheDocument();
    await user.type(searchInput(), 'd');

    expect(screen.getByText('Scrivi almeno 2 lettere.')).toBeInTheDocument();
    expect(searchCalls()).toEqual([]);
  });

  // Spec 21 Decision 3: grouped by kind, matched words marked, a click opens the place.
  it('lists the results by kind with the matched words marked', async () => {
    const { user, onClose } = render();

    await user.type(searchInput(), 'drago');

    const list = await screen.findByRole('listbox', { name: 'Risultati' });
    expect(searchCalls()).toEqual(['/rooms/room-1/search?q=drago&limit=10']);
    const documents = within(list).getByRole('group', { name: 'Documenti' });
    expect(within(documents).getByRole('option')).toHaveTextContent(
      'Il Castello del DragoSulla collina.',
    );
    expect(within(documents).getByText('Drago', { selector: 'mark' })).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Note' })).toHaveTextContent('in Il Castello');
    expect(within(list).getByRole('group', { name: 'Commenti' })).toHaveTextContent(
      'Commento su Il Castello',
    );
    expect(within(list).queryByRole('group', { name: 'Tag' })).not.toBeInTheDocument();

    await user.click(within(list).getByRole('option', { name: /Drago!/ }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/rooms/room-1/documents/doc-1#comment-c-1',
    );
  });

  it('moves through the results with the arrow keys and opens one with Enter', async () => {
    const { user, onClose } = render();
    const input = searchInput();

    await user.type(input, 'drago');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    await user.keyboard('{ArrowUp}');
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await user.hover(options[0]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // Other keys edit the query as usual.
    await user.keyboard('{Home}');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/rooms/room-1/documents/doc-1#note-note-1',
    );
  });

  it('ignores the arrow keys and Enter while there is nothing to pick', async () => {
    searchResponse = { documents: empty, notes: empty, comments: empty, tags: empty };
    const { user, onClose } = render();

    await user.type(searchInput(), 'zzz');
    expect(await screen.findByText('Nessun risultato')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('filters by kind and Tag, and shows more of one kind', async () => {
    const { user } = render();

    await user.type(searchInput(), 'drago');
    await screen.findByRole('listbox');
    await user.click(screen.getByRole('button', { name: 'Mostra altri' }));
    await waitFor(() =>
      expect(searchCalls()).toContain('/rooms/room-1/search?q=drago&limit=50&kind=document'),
    );

    await user.click(screen.getByRole('radio', { name: 'Note' }));
    await waitFor(() =>
      expect(searchCalls()).toContain('/rooms/room-1/search?q=drago&limit=10&kind=note'),
    );
    await user.click(screen.getByRole('radio', { name: 'Tutto' }));

    await user.click(screen.getByRole('combobox', { name: 'Filtra per Tag' }));
    await user.click(await screen.findByRole('option', { name: 'PNG' }));
    await waitFor(() =>
      expect(searchCalls()).toContain('/rooms/room-1/search?q=drago&limit=10&tag=tag-1'),
    );

    // A new query or Tag filter asks for the usual number again, in the kind
    // still chosen.
    const base = '/rooms/room-1/search?q=';
    await user.click(screen.getByRole('button', { name: 'Mostra altri' }));
    await waitFor(() =>
      expect(searchCalls()).toContain(`${base}drago&limit=50&kind=document&tag=tag-1`),
    );
    await user.type(searchInput(), 'n');
    await waitFor(() =>
      expect(searchCalls()).toContain(`${base}dragon&limit=10&kind=document&tag=tag-1`),
    );
    await user.click(screen.getByRole('button', { name: 'Mostra altri' }));
    await waitFor(() =>
      expect(searchCalls()).toContain(`${base}dragon&limit=50&kind=document&tag=tag-1`),
    );
    await user.click(screen.getByRole('combobox', { name: 'Filtra per Tag' }));
    await user.click(await screen.findByRole('option', { name: 'PNG' }));
    await waitFor(() =>
      expect(searchCalls()).toContain(`${base}dragon&limit=10&kind=document`),
    );
  });

  it('shows a loader until the first results arrive', async () => {
    fetchMock.mockImplementation(async (path: string) =>
      path.includes('/search') ? new Promise(() => {}) : [],
    );
    const { user } = render();

    await user.type(searchInput(), 'drago');

    expect(await screen.findByLabelText('Ricerca in corso')).toBeInTheDocument();
  });

  it('lists Tags by name and leads to the Documents they filter', async () => {
    searchResponse = {
      documents: empty,
      notes: empty,
      comments: empty,
      tags: {
        items: [rawHit('tag', 'tag-1', { title: { text: 'PNG', highlights: [[0, 2]] } })],
        has_more: false,
      },
    };
    const { user } = render();

    await user.type(searchInput(), 'pn');
    const tags = await screen.findByRole('group', { name: 'Tag' });
    await user.click(within(tags).getByRole('option'));

    expect(screen.getByTestId('location')).toHaveTextContent('/rooms/room-1/documents?tag=tag-1');
  });
});
