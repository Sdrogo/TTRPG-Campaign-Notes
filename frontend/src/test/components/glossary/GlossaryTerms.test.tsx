import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
