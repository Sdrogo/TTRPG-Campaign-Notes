import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentMentionsContext } from '../../../hooks/useDocumentMentions';
import { renderWithProviders } from '../../utils';
import { MentionText } from '../../../components/mentions/MentionText';
import type { DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';
import type { ReactNode } from 'react';
import type { Member } from '../../../types/member';

function document(id: string, name: string): Document {
  return {
    id,
    roomId: 'room-1',
    name,
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
}

function withMentions(children: ReactNode, overrides: Partial<DocumentMentionsValue> = {}) {
  const value: DocumentMentionsValue = {
    roomId: 'room-1',
    documents: [document('doc-1', 'Il Cancello')],
    tags: [{ id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null }],
    canCreateDocument: false,
    canCreateTag: false,
    create: async () => {
      throw new Error('not used');
    },
    ...overrides,
  };
  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}

describe('MentionText', () => {
  it('renders plain text unchanged', () => {
    renderWithProviders(withMentions(<MentionText text="Nessuna menzione qui." />));

    expect(screen.getByText('Nessuna menzione qui.')).toBeInTheDocument();
  });

  it('links a Document mention to the Document', () => {
    renderWithProviders(withMentions(<MentionText text="Vai al #Il Cancello subito." />));

    expect(screen.getByTestId('document-mention').closest('a')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  // A Tag mention goes to the Documents list filtered by that Tag (FR-N2).
  it('links a Tag mention to the filtered Documents list', () => {
    renderWithProviders(withMentions(<MentionText text="Cerca in #Luoghi." />));

    expect(screen.getByTestId('tag-mention').closest('a')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents?tag=tag-1',
    );
  });

  // VR-07: a mention of something the viewer can't see must not reveal that
  // it exists. The backend already filtered it out of their Document list,
  // so it simply doesn't resolve and stays plain text.
  it('leaves a mention of an unknown target as plain text', () => {
    renderWithProviders(withMentions(<MentionText text="Il #Segreto Nascosto esiste?" />));

    expect(screen.queryByTestId('document-mention')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // Inside a card that is itself a link: an <a> may not contain another.
  it('colors but does not link a mention when linking is off', () => {
    renderWithProviders(withMentions(<MentionText text="Vai al #Il Cancello." linked={false} />));

    expect(screen.getByTestId('document-mention')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // Outside a provider (no Room context) there is nothing to resolve
  // against, so everything is plain text rather than a broken link.
  it('renders plain text with no mentions context at all', () => {
    renderWithProviders(<MentionText text="Vai al #Il Cancello." />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Il Cancello/)).toBeInTheDocument();
  });

  it('renders several mentions in one body', () => {
    renderWithProviders(withMentions(<MentionText text="#Il Cancello e #Luoghi" />));

    expect(screen.getByTestId('document-mention')).toBeInTheDocument();
    expect(screen.getByTestId('tag-mention')).toBeInTheDocument();
  });

  // Spec 19c: `@[Name](user:<uuid>)` tokens in Comments.
  describe('member mentions', () => {
    const ARA = '11111111-1111-4111-8111-111111111111';
    const members: Member[] = [
      {
        userId: ARA,
        role: 'player',
        isAdmin: false,
        email: null,
        displayName: 'Ara la Saggia',
        pronouns: null,
        bio: null,
        avatarUrl: null,
      },
    ];

    it('highlights a member under their current name', () => {
      renderWithProviders(
        withMentions(<MentionText text={`Chiedi a @[Ara](user:${ARA}) del #Il Cancello`} members={members} />),
      );

      expect(screen.getByTestId('user-mention')).toHaveTextContent('@Ara la Saggia');
      expect(screen.getByTestId('document-mention')).toBeInTheDocument();
    });

    it('shows someone no longer in the Room as written, without highlighting', () => {
      renderWithProviders(
        <MentionText text="Chiedi a @[Carla](user:33333333-3333-4333-8333-333333333333)." members={members} />,
      );

      expect(screen.queryByTestId('user-mention')).not.toBeInTheDocument();
      expect(screen.getByText('Chiedi a @Carla.')).toBeInTheDocument();
    });

    it('leaves tokens as written where members are not given', () => {
      const text = `Chiedi a @[Ara](user:${ARA})`;
      renderWithProviders(<MentionText text={text} />);

      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });
});
