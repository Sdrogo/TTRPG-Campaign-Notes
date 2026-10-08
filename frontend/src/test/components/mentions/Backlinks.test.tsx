import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { renderWithProviders } from '../../utils';
import { Backlinks } from '../../../components/mentions/Backlinks';
import { backlinkHref } from '../../../lib/backlinks';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Backlink } from '../../../types/backlink';
import type { Document } from '../../../types/document';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const members: Member[] = [
  {
    userId: 'user-2',
    role: 'player',
    isAdmin: false,
    email: null,
    displayName: 'Ara',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];

const document: Document = {
  id: '',
  roomId: 'room-1',
  name: '',
  description: '',
  visibility: 'room',
  images: [],
  tagIds: [],
  ownerIds: [],
  selectiveUserIds: [],
  notes: [],
  files: [],
  playedBy: null,
};

function mention(overrides: Record<string, unknown>) {
  return {
    kind: 'description',
    note_id: null,
    note_title: null,
    comment_id: null,
    comment_author_id: null,
    excerpt: 'Vai al #Il Cancello',
    ...overrides,
  };
}

function render() {
  return renderWithProviders(
    <Backlinks roomId="room-1" target={{ kind: 'document', id: 'doc-1' }} members={members} />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('Backlinks', () => {
  it('lists every place a Document mentions the target, grouped by Document', async () => {
    fetchMock.mockResolvedValue([
      {
        document_id: 'doc-2',
        document_name: 'La Locanda',
        mentions: [
          mention({}),
          mention({ kind: 'note', note_id: 'note-1', note_title: 'Segreti', excerpt: 'nota' }),
          mention({
            kind: 'comment',
            comment_id: 'comment-1',
            comment_author_id: 'user-2',
            excerpt: 'commento',
          }),
        ],
      },
    ]);

    render();

    expect(await screen.findByText('Menzionato in')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'La Locanda' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2',
    );
    expect(screen.getByRole('link', { name: 'Nella descrizione' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2',
    );
    expect(screen.getByRole('link', { name: 'Nella nota «Segreti»' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'In un commento di Ara' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-2#comment-comment-1',
    );
    expect(screen.getByText('Vai al #Il Cancello')).toBeInTheDocument();
  });

  it('shows the mentions in an excerpt under their current names', async () => {
    const tower = '11111111-1111-4111-8111-111111111111';
    fetchMock.mockResolvedValue([
      {
        document_id: 'doc-2',
        document_name: 'La Locanda',
        mentions: [mention({ excerpt: `Vai al #[La Torre](doc:${tower}).` })],
      },
    ]);
    const mentions: DocumentMentionsValue = {
      roomId: 'room-1',
      documents: [{ ...document, id: tower, name: 'La Guglia' }],
      tags: [],
      canCreateDocument: false,
      canCreateTag: false,
      create: vi.fn(),
    };

    renderWithProviders(
      <DocumentMentionsContext value={mentions}>
        <Backlinks roomId="room-1" target={{ kind: 'document', id: tower }} members={members} />
      </DocumentMentionsContext>,
    );

    expect(await screen.findByRole('link', { name: '#La Guglia' })).toHaveAttribute(
      'href',
      `/rooms/room-1/documents/${tower}`,
    );
  });

  // Decision 6: hidden when empty, and while loading or failed.
  it('shows nothing while nothing mentions the target', async () => {
    fetchMock.mockResolvedValue([]);

    render();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('backlinks')).not.toBeInTheDocument();
  });

  it('collapses and expands', async () => {
    fetchMock.mockResolvedValue([
      { document_id: 'doc-2', document_name: 'La Locanda', mentions: [mention({})] },
    ]);
    const user = userEvent.setup();
    render();
    const toggle = await screen.findByRole('button', { name: /Menzionato in/ });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('backlinkHref', () => {
  const base: Backlink = {
    kind: 'description',
    noteId: null,
    noteTitle: null,
    commentId: null,
    commentAuthorId: null,
    excerpt: '',
  };

  it("leads to a Comment's anchor, and otherwise to the Document", () => {
    expect(backlinkHref('room-1', 'doc-2', base)).toBe('/rooms/room-1/documents/doc-2');
    expect(backlinkHref('room-1', 'doc-2', { ...base, kind: 'comment', commentId: 'c-1' })).toBe(
      '/rooms/room-1/documents/doc-2#comment-c-1',
    );
  });
});
