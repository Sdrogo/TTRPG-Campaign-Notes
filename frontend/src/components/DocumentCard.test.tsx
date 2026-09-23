import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentCard } from './DocumentCard';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

const tags: Tag[] = [
  { id: 'tag-1', name: 'Luoghi', category: null },
  { id: 'tag-2', name: 'PNG', category: null },
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

  // The card is a link already, and an <a> may not contain another - so a
  // mention in the description is colored but not linked here.
  it('does not nest a mention link inside the card link', () => {
    render({ description: 'Accanto a #PNG.' });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(within(links[0]).queryByTestId('tag-mention')).not.toBeInTheDocument();
  });
});
