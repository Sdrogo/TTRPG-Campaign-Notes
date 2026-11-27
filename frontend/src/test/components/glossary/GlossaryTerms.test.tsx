import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlossaryTermPreview } from '../../../components/glossary/GlossaryTermPreview';
import { HOVER_POINTER_QUERY } from '../../../components/mentions/DocumentMentionPreview';
import { DocumentMentionsContext } from '../../../hooks/useDocumentMentions';
import { renderWithProviders } from '../../utils';
import { MentionText } from '../../../components/mentions/MentionText';
import { MarkdownText } from '../../../components/mentions/MarkdownText';
import type { DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { GlossaryEntry } from '../../../types/glossary';

const mist: GlossaryEntry = {
  id: 'g1',
  term: 'Mist',
  aliases: ['The Fog'],
  definition: 'A deadly **haze** over Barovia.',
  visibility: 'room',
  selectiveUserIds: [],
  highlight: true,
  tagIds: ['tag-1'],
  documents: [{ id: 'doc-1', name: 'Castle' }],
  createdAt: '',
  updatedAt: '',
  canEdit: false,
  canDelete: false,
};

function withGlossary(children: React.ReactNode, glossary: GlossaryEntry[] = [mist]) {
  const value: DocumentMentionsValue = {
    roomId: 'room-1',
    documents: [],
    tags: [{ id: 'tag-1', name: 'Rule', category: null, mainPosition: null }],
    glossary,
    canCreateDocument: false,
    canCreateTag: false,
    create: async () => {
      throw new Error('not used');
    },
  };
  return <DocumentMentionsContext value={value}>{children}</DocumentMentionsContext>;
}

describe('Glossary terms in texts', () => {
  it('highlights a term in a mention text, once, keeping the written word', () => {
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in. The mist stays." />));

    const terms = screen.getAllByTestId('glossary-term');
    expect(terms).toHaveLength(1);
    expect(terms[0]).toHaveTextContent('mist');
  });

  it('highlights a term inside Markdown, next to its formatting', () => {
    renderWithProviders(withGlossary(<MarkdownText text="Beware the **Mist** tonight" />));

    expect(screen.getByTestId('glossary-term')).toHaveTextContent('Mist');
  });

  it('shows plain text when the Room has no Glossary or the device switched it off', () => {
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in." />, []));

    expect(screen.queryByTestId('glossary-term')).toBeNull();
  });

  it('opens the definition card on a tap when the device cannot hover', async () => {
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in." />));

    await userEvent.click(screen.getByTestId('glossary-term'));

    const card = await screen.findByTestId('glossary-preview');
    expect(card).toHaveTextContent('Mist');
    expect(card).toHaveTextContent('haze');
    expect(card).toHaveTextContent('#Rule');
    expect(screen.getByRole('link', { name: 'Castle' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });
});

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

describe('the term card', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('opens on hover where there is a mouse', async () => {
    setCanHover(true);
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in." />));

    await userEvent.hover(screen.getByTestId('glossary-term'));

    expect(await screen.findByTestId('glossary-preview')).toHaveTextContent('haze');
  });

  it('opens and closes from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in." />));

    screen.getByTestId('glossary-term').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('glossary-preview')).toBeInTheDocument();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.queryByTestId('glossary-preview')).toBeNull());
    await user.keyboard('x');
    expect(screen.queryByTestId('glossary-preview')).toBeNull();
  });

  it('stays plain inside a link, where a card cannot open', () => {
    renderWithProviders(withGlossary(<MentionText text="The mist rolls in." linked={false} />));

    expect(screen.queryByTestId('glossary-term')).toBeNull();
    expect(screen.getByText('The mist rolls in.')).toBeInTheDocument();
  });

  it('also works outside a mentions context, with a bare entry', async () => {
    renderWithProviders(
      <GlossaryTermPreview roomId="room-1" entry={{ ...mist, definition: '  ', aliases: [] }} tags={[]}>
        mist
      </GlossaryTermPreview>,
    );

    await userEvent.click(screen.getByTestId('glossary-term'));

    expect(await screen.findByTestId('glossary-preview')).toHaveTextContent('Mist');
  });

  it('shows an entry without a definition, aliases, Tags or Documents', async () => {
    renderWithProviders(
      withGlossary(<MentionText text="The mist rolls in." />, [
        { ...mist, definition: '', aliases: [], tagIds: [], documents: [] },
      ]),
    );

    await userEvent.click(screen.getByTestId('glossary-term'));

    expect(await screen.findByTestId('glossary-preview')).toHaveTextContent('Mist');
  });
});
