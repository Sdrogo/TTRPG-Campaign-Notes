import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../utils';
import { DocumentCard } from '../../components/DocumentCard';
import type { Document } from '../../types/document';
import type { Member } from '../../types/member';
import type { Tag } from '../../types/tag';
import { DocumentMentionsContext } from '../../hooks/useDocumentMentions';

const tags: Tag[] = [
  { id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null },
  { id: 'tag-2', name: 'PNG', category: null, mainPosition: null },
];

const members: Member[] = [
  {
    userId: 'user-1',
    role: 'master',
    isAdmin: true,
    email: 'master@example.com',
    displayName: 'Il Master',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];

function document(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    roomId: 'room-1',
    name: 'Il Cancello',
    description: 'Una porta di pietra.',
    visibility: 'room',
    images: [],
    tagIds: ['tag-1'],
    ownerIds: ['user-1'],
    selectiveUserIds: [],
    notes: [],
    files: [],
    playedBy: null,
    ...overrides,
  };
}

function render(overrides: Partial<Document> = {}) {
  return renderWithProviders(
    <DocumentCard document={document(overrides)} roomId="room-1" tags={tags} members={members} />,
  );
}

describe('DocumentCard', () => {
  it('shows the name, description and Tags', () => {
    render();

    expect(screen.getByText('Il Cancello')).toBeInTheDocument();
    expect(screen.getByText('Una porta di pietra.')).toBeInTheDocument();
    expect(screen.getByText('#Luoghi')).toBeInTheDocument();
  });

  it('shows the visibility level', () => {
    render({ visibility: 'master' });

    expect(screen.getByText('Solo Master')).toBeInTheDocument();
  });

  // The whole card is one link (it overlays the content), so its accessible
  // name has to be the Document's name.
  it('links the whole card to the Document', () => {
    render();

    expect(screen.getByRole('link', { name: 'Il Cancello' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  // D-23: a Character's card names who plays it.
  it('names the player of a Character', () => {
    render({ playedBy: 'user-1' });

    expect(screen.getByText('Interpretato da Il Master')).toBeInTheDocument();
  });

  it('says nothing about a player on any other Document', () => {
    render();

    expect(screen.queryByText(/Interpretato da/)).not.toBeInTheDocument();
  });

  it('names the Owners by their profile name', () => {
    render();

    expect(screen.getByText('Owner: Il Master')).toBeInTheDocument();
  });

  it('says so when there is no description', () => {
    render({ description: '' });

    expect(screen.getByText('Nessuna descrizione.')).toBeInTheDocument();
  });

  it('omits the Owner line when the Document has no Owners', () => {
    render({ ownerIds: [] });

    expect(screen.queryByText(/^Owner:/)).not.toBeInTheDocument();
  });

  it('shows no image area when the Document has none', () => {
    render();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('leads with the Document image when it has one', () => {
    render({ images: [{ id: 'image-1', url: 'http://a/1.webp', isFavorite: true }] });

    expect(screen.getByAltText('Il Cancello')).toHaveAttribute('src', 'http://a/1.webp');
  });

  // On a wide card the image panel would otherwise be a short strip that crops
  // the image to a sliver: a square floor keeps the card at least that tall.
  it('keeps the image panel at least square', () => {
    render({ images: [{ id: 'image-1', url: 'http://a/1.webp', isFavorite: true }] });

    expect(screen.getByTestId('card-image-floor')).toHaveStyle({ aspectRatio: '1' });
  });

  it('has no image floor without images', () => {
    render();

    expect(screen.queryByTestId('card-image-floor')).not.toBeInTheDocument();
  });

  // The card is a link already, and an <a> may not contain another - so a
  // mention in the description is colored but not linked here.
  it('does not nest a mention link inside the card link', () => {
    renderWithProviders(
      <DocumentCard
        document={document({ description: 'Accanto a #PNG.' })}
        roomId="room-1"
        tags={tags}
        members={members}
      />,
      {
        wrapper: ({ children }) => (
          <DocumentMentionsContext
            value={{
              roomId: 'room-1',
              documents: [],
              tags,
              canCreateDocument: false,
              canCreateTag: false,
              create: async () => {
                throw new Error('not used');
              },
            }}
          >
            {children}
          </DocumentMentionsContext>
        ),
      },
    );

    const mention = screen.getByTestId('tag-mention');
    expect(mention.tagName).not.toBe('A');
    // The card's own link, plus the TagList's own clickable Tag (spec 10) -
    // but no second link nested around the mention itself.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

// Spec 10: every Tag in the "Tags on their own line" section is clickable,
// unlike a plain mention inside the description.
describe('clicking a Tag', () => {
  it('links each Tag to the Documents list filtered by it', () => {
    render();

    expect(screen.getByRole('link', { name: '#Luoghi' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents?tag=tag-1',
    );
  });
});

// Spec 19b: what is new in the Thread since the viewer last opened it.
describe('unread mark', () => {
  it('shows how many Comments are new, with a label', () => {
    render({ unreadCount: 3 });
    expect(screen.getByLabelText('3 nuovi commenti')).toHaveTextContent('3');
  });

  it('shows a "not yet read" dot for a Document never opened', () => {
    render({ unreadCount: null });
    expect(screen.getByRole('img', { name: 'Non ancora letto' })).toBeInTheDocument();
  });

  it('shows nothing when nothing is new', () => {
    render({ unreadCount: 0 });
    expect(screen.queryByLabelText(/nuov/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Non ancora letto' })).not.toBeInTheDocument();
  });
});
