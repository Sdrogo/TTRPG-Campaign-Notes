import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { matchMediaQueries } from '../../media';
import { MentionText } from '../../../components/mentions/MentionText';
import { HOVER_POINTER_QUERY } from '../../../components/mentions/DocumentMentionPreview';
import { DocumentCardNode } from '../../../components/maps/DocumentCardNode';
import { SPLIT_QUERY } from '../../../hooks/useSideDocument';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';
import type { MapCard } from '../../../types/map';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(async () => []) }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ...(await import('../../xyflowMock')).xyflowMock,
}));

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

const CARD: MapCard = {
  id: 'card-1',
  documentId: 'doc-2',
  text: null,
  groupId: null,
  caption: null,
  imageId: null,
  size: 'normal',
  masterOnly: false,
  color: 'default',
  struck: false,
  x: 0,
  y: 0,
  document: { id: 'doc-2', name: 'Thorn', subtitle: 'Il mercenario', image: null, tagIds: [] },
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

function renderNode({ editable = false, dragging = false, documents = [THORN] } = {}) {
  const props = { id: 'card-1', data: { card: CARD, roomId: 'room-1', editable, onEdit: vi.fn() }, dragging };
  renderWithProviders(
    withMentions(<DocumentCardNode {...(props as unknown as ComponentProps<typeof DocumentCardNode>)} />, documents),
  );
  return userEvent.setup();
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

describe('A Document card on a map (spec 37 Decisions 1 and 2)', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('previews the Document while the pointer rests on the card', async () => {
    restore = matchMediaQueries([HOVER_POINTER_QUERY]);
    const user = renderNode();

    await user.hover(screen.getByText('Il mercenario'));

    expect(await screen.findByRole('heading', { name: 'Thorn' })).toBeInTheDocument();
    expect(screen.getByText('Un mercenario stanco.')).toBeInTheDocument();
  });

  it('previews nothing while the card is dragged', async () => {
    restore = matchMediaQueries([HOVER_POINTER_QUERY]);
    const user = renderNode({ editable: true, dragging: true });

    await user.hover(screen.getByText('Il mercenario'));

    await expectNoPreview();
  });

  it('previews nothing for a Document the page does not have', async () => {
    restore = matchMediaQueries([HOVER_POINTER_QUERY]);
    const user = renderNode({ documents: [] });

    await user.hover(screen.getByText('Il mercenario'));

    await expectNoPreview();
  });

  it('opens the menu from anywhere on a read-only card', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderNode();

    await user.click(screen.getByText('Il mercenario'));

    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
  });

  it('opens the menu only from the name on a card being edited', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderNode({ editable: true });

    await user.click(screen.getByText('Il mercenario'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
  });

  it('keeps the card preview shut while its menu shows', async () => {
    restore = matchMediaQueries([SPLIT_QUERY, HOVER_POINTER_QUERY]);
    const user = renderNode({ editable: true });

    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    expect(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' })).toBeInTheDocument();
    await expectNoPreview();
  });
});
