import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { rawHistoryEntry } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { VisibilityHistory } from '../../../components/setup/VisibilityHistory';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function member(userId: string, displayName: string): Member {
  return {
    userId,
    role: 'player',
    isAdmin: false,
    email: null,
    displayName,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

const members = [member('user-1', 'Master'), member('user-2', 'Alice'), member('user-3', 'Bob')];

function render() {
  renderWithProviders(<VisibilityHistory roomId="room-1" members={members} />);
  return { user: userEvent.setup() };
}

const table = () => screen.getByTestId('history-table');
const list = () => screen.getByTestId('history-list');

beforeEach(() => {
  fetchMock.mockReset();
});

describe('VisibilityHistory', () => {
  it('lists a Reveal with who did it, what, before and after, and who gained it', async () => {
    fetchMock.mockResolvedValue({ entries: [rawHistoryEntry()], next_before: null });
    render();

    expect(await screen.findByTestId('history-table')).toBeInTheDocument();
    const row = within(table()).getAllByRole('row')[1];
    expect(within(row).getByText('Master')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Il Cancello' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
    expect(within(row).getByText('Solo Master')).toBeInTheDocument();
    expect(within(row).getByText('Stanza')).toBeInTheDocument();
    expect(within(row).getByText('Rivelazione')).toBeInTheDocument();
    expect(within(row).getByText('Ora lo vedono: Alice')).toBeInTheDocument();
    // The same entry, as a list for phones.
    expect(within(list()).getByRole('link', { name: 'Il Cancello' })).toBeInTheDocument();
  });

  it('names a Note and a Comment, and the Selective grants', async () => {
    fetchMock.mockResolvedValue({
      entries: [
        rawHistoryEntry({
          id: 'e-note',
          kind: 'note',
          is_reveal: false,
          note_id: 'note-1',
          note_title: 'Porta segreta',
          to_visibility: 'selective',
          selective_user_ids: ['user-2', 'user-3'],
          recipient_ids: [],
        }),
        rawHistoryEntry({ id: 'e-comment', kind: 'comment', comment_id: 'c-1' }),
      ],
      next_before: null,
    });
    render();

    const note = await within(await screen.findByTestId('history-table')).findByRole('link', {
      name: 'Nota "Porta segreta" in Il Cancello',
    });
    expect(note).toHaveAttribute('href', '/rooms/room-1/documents/doc-1');
    expect(within(table()).getByText('Scelti: Alice, Bob')).toBeInTheDocument();
    expect(within(table()).getByRole('link', { name: 'Commento in Il Cancello' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1#comment-c-1',
    );
  });

  // VR-07: content the reader can't see, or that is gone, isn't named.
  it('names hidden and deleted content by its kind only', async () => {
    fetchMock.mockResolvedValue({
      entries: [
        rawHistoryEntry({
          id: 'e-hidden',
          kind: 'note',
          state: 'hidden',
          document_id: null,
          document_name: null,
          recipient_ids: [],
        }),
        rawHistoryEntry({
          id: 'e-deleted',
          state: 'deleted',
          document_id: null,
          document_name: null,
          recipient_ids: [],
        }),
      ],
      next_before: null,
    });
    render();

    expect(
      await within(await screen.findByTestId('history-table')).findByText('Una Nota nascosta'),
    ).toBeInTheDocument();
    expect(within(table()).getByText('Un Documento eliminato')).toBeInTheDocument();
    expect(within(table()).queryByRole('link')).not.toBeInTheDocument();
  });

  it('filters by kind of content', async () => {
    fetchMock.mockResolvedValue({ entries: [], next_before: null });
    const { user } = render();

    expect(await screen.findByText('Nessun cambio di visibilità.')).toBeInTheDocument();
    await user.click(screen.getByText('Commenti'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/audit-log?kind=comment'),
    );
  });

  it('loads the next page on demand', async () => {
    fetchMock
      .mockResolvedValueOnce({ entries: [rawHistoryEntry()], next_before: 'entry-1' })
      .mockResolvedValueOnce({
        entries: [rawHistoryEntry({ id: 'entry-2', document_name: 'La Torre' })],
        next_before: null,
      });
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Carica altri' }));

    expect(
      await within(table()).findByRole('link', { name: 'La Torre' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carica altri' })).not.toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Impossibile caricare la cronologia.')).toBeInTheDocument();
  });
});
