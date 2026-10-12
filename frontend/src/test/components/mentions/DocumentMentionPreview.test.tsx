import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderWithProviders } from '../../utils';
import { MentionText } from '../../../components/mentions/MentionText';
import { HOVER_POINTER_QUERY } from '../../../components/mentions/DocumentMentionPreview';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(async () => []) }));

const GATE: Document = {
  id: 'doc-1',
  roomId: 'room-1',
  name: 'Il Cancello',
  description: 'Un cancello di ferro battuto, sempre chiuso.',
  visibility: 'room',
  images: [],
  tagIds: ['tag-1'],
  ownerIds: [],
  selectiveUserIds: [],
  notes: [],
  files: [],
  playedBy: null,
};

function withMentions(children: ReactNode) {
  const value: DocumentMentionsValue = {
    roomId: 'room-1',
    documents: [GATE],
    tags: [{ id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null }],
    canCreateDocument: false,
    canCreateTag: false,
    create: async () => {
      throw new Error('not used');
    },
  };
  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}

function setCanHover(canHover: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: canHover && query === HOVER_POINTER_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
}

// Spec 32: hovering a `#Document` mention previews the Document's card.
describe('DocumentMentionPreview', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => setCanHover(true));
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("shows the Document's card while the pointer rests on its mention", async () => {
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Vai al #Il Cancello subito." />));

    await user.hover(screen.getByTestId('document-mention'));

    expect(await screen.findByRole('heading', { name: 'Il Cancello' })).toBeInTheDocument();
    expect(screen.getByText('Un cancello di ferro battuto, sempre chiuso.')).toBeInTheDocument();
    // The card links to the Document, like the mention.
    expect(screen.getByRole('link', { name: 'Il Cancello' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  it('previews nothing for a Tag mention', async () => {
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Cerca in #Luoghi." />));

    await user.hover(screen.getByTestId('tag-mention'));

    await expectNoPreview();
  });

  // Inside a card the mention is only colored, so a preview never nests.
  it('previews nothing for a mention that is not a link', async () => {
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Vai al #Il Cancello." linked={false} />));

    await user.hover(screen.getByTestId('document-mention'));

    await expectNoPreview();
  });

  // On a touch screen a tap just follows the link.
  it('previews nothing on a device that cannot hover', async () => {
    setCanHover(false);
    const user = userEvent.setup();
    renderWithProviders(withMentions(<MentionText text="Vai al #Il Cancello." />));

    await user.hover(screen.getByTestId('document-mention'));

    await expectNoPreview();
  });
});

/** Waits past the open delay, then checks no card appeared. */
async function expectNoPreview() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitFor(() => expect(screen.queryByRole('heading')).not.toBeInTheDocument());
}
