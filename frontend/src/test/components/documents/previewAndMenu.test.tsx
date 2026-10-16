import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { matchMediaQueries } from '../../media';
import { MentionText } from '../../../components/mentions/MentionText';
import { HOVER_POINTER_QUERY } from '../../../components/mentions/DocumentMentionPreview';
import { SPLIT_QUERY } from '../../../hooks/useSideDocument';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(async () => []) }));

const THORN: Document = {
  id: 'doc-2',
  roomId: 'room-1',
  name: 'Thorn',
  description: 'Un mercenario stanco.',
  visibility: 'room',
  images: [],
  tagIds: [],
  ownerIds: [],
  selectiveUserIds: [],
  notes: [],
  files: [],
  playedBy: null,
  subtitle: null,
};

function withMentions(children: ReactNode, documents: Document[] = [THORN]) {
  const value: DocumentMentionsValue = {
    roomId: 'room-1',
    documents,
    tags: [{ id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null }],
    canCreateDocument: false,
    canCreateTag: false,
    create: async () => {
      throw new Error('not used');
    },
  };
  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}

/** Waits past the open delay, then checks no card appeared. */
async function expectNoPreview() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Thorn' })).not.toBeInTheDocument());
}

describe('Mentions on a Document card (spec 37 Decision 2)', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('makes Document mentions links with the open menu, and leaves Tag mentions plain', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Chiedi a #Thorn in #Luoghi." linked="documents" />));

    const mention = screen.getByTestId('document-mention');
    expect(mention.closest('a')).toHaveAttribute('href', '/rooms/room-1/documents/doc-2');
    expect(screen.getByTestId('tag-mention').closest('a')).toBeNull();

    await user.click(mention);
    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Apri il Documento' })).toBeInTheDocument();
  });

  // Clicked before the preview's delay ran out: the preview must not cover the menu.
  it('keeps the preview shut while the menu shows', async () => {
    restore = matchMediaQueries([SPLIT_QUERY, HOVER_POINTER_QUERY]);
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Chiedi a #Thorn." linked="documents" />));

    await user.click(screen.getByTestId('document-mention'));
    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
    await expectNoPreview();
  });

  it('closes an open preview when the menu opens', async () => {
    restore = matchMediaQueries([SPLIT_QUERY, HOVER_POINTER_QUERY]);
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Chiedi a #Thorn." />));

    await user.hover(screen.getByTestId('document-mention'));
    expect(await screen.findByRole('heading', { name: 'Thorn' })).toBeInTheDocument();
    await user.click(screen.getByTestId('document-mention'));
    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Thorn' })).not.toBeInTheDocument());
  });
});
