import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentMentionsContext } from '../../../hooks/useDocumentMentions';
import { renderWithProviders } from '../../utils';
import { MarkdownText } from '../../../components/mentions/MarkdownText';
import type { DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';
import type { ReactNode } from 'react';

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
    subtitle: null,
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

const DOC = '00000000-0000-4000-8000-000000000001';

describe('MarkdownText', () => {
  it('renders headings, emphasis, lists, quotes, tables and code', () => {
    const { container } = renderWithProviders(
      withMentions(
        <MarkdownText
          text={
            '# Titolo\n\n**forte** e *corsivo* e ~~via~~\n\n- uno\n- due\n\n1. primo\n\n> citazione\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n`codice`'
          }
        />,
      ),
    );

    // Decision 5: `#` is an h3 under the page's own headings.
    expect(container.querySelector('h3')).toHaveTextContent('Titolo');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('strong')).toHaveTextContent('forte');
    expect(container.querySelector('em')).toHaveTextContent('corsivo');
    expect(container.querySelector('del')).toHaveTextContent('via');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelector('ol li')).toHaveTextContent('primo');
    expect(container.querySelector('blockquote')).toHaveTextContent('citazione');
    expect(container.querySelector('.markdown-table table td')).toHaveTextContent('1');
    expect(container.querySelector('code')).toHaveTextContent('codice');
  });

  // Decision 2: texts written before spec 48 read as they did.
  it('keeps a single line break', () => {
    const { container } = renderWithProviders(withMentions(<MarkdownText text={'riga uno\nriga due'} />));

    expect(container.querySelector('br')).not.toBeNull();
  });

  it('renders paragraphs as divs, so a mention preview can nest', () => {
    const { container } = renderWithProviders(withMentions(<MarkdownText text="Solo testo." />));

    expect(container.querySelector('p')).toBeNull();
    expect(screen.getByText('Solo testo.')).toBeInTheDocument();
  });

  // Decision 3.
  it('shows raw HTML as text and never runs it', () => {
    const { container } = renderWithProviders(
      withMentions(<MarkdownText text={'<script>alert(1)</script>\n\nciao <b>x</b>'} />),
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
  });

  it('links only http, https and mailto addresses, in a new tab', () => {
    renderWithProviders(
      withMentions(<MarkdownText text={'[buono](https://example.com) [cattivo](javascript:alert(1))'} />),
    );

    const good = screen.getByText('buono').closest('a');
    expect(good).toHaveAttribute('href', 'https://example.com');
    expect(good).toHaveAttribute('target', '_blank');
    expect(good).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('cattivo').closest('a')).toBeNull();
  });

  it('shows an image as a link to it, never loading it', () => {
    const { container } = renderWithProviders(
      withMentions(<MarkdownText text={'![mappa](https://example.com/m.png)'} />),
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('mappa').closest('a')).toHaveAttribute('href', 'https://example.com/m.png');
  });

  // Decision 4: a token looks like a Markdown link but stays a mention.
  it('links a Document mention inside bold, a list and a table', () => {
    renderWithProviders(
      withMentions(
        <MarkdownText
          text={`**#[Il Cancello](doc:${DOC})**\n\n- #[Il Cancello](doc:${DOC})\n\n| x |\n| - |\n| #[Il Cancello](doc:${DOC}) |`}
        />,
        { documents: [document(DOC, 'Il Cancello')] },
      ),
    );

    const links = screen.getAllByTestId('document-mention');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.closest('a')).toHaveAttribute('href', `/rooms/room-1/documents/${DOC}`);
    }
    expect(links[0].closest('strong')).not.toBeNull();
  });

  it('links a plain #Name written before mentions had ids', () => {
    renderWithProviders(withMentions(<MarkdownText text="- Vai al #Il Cancello **subito**." />));

    expect(screen.getByTestId('document-mention').closest('a')).toHaveAttribute(
      'href',
      '/rooms/room-1/documents/doc-1',
    );
  });

  it('shows a mention inside code as written, not linked', () => {
    const { container } = renderWithProviders(
      withMentions(<MarkdownText text={`\`#[Il Cancello](doc:${DOC})\``} />, {
        documents: [document(DOC, 'Il Cancello')],
      }),
    );

    expect(screen.queryByTestId('document-mention')).toBeNull();
    expect(container.querySelector('code')).toHaveTextContent('#Il Cancello');
  });

  it('only colors a mention inside a Markdown link', () => {
    renderWithProviders(
      withMentions(<MarkdownText text={`[vedi #[Il Cancello](doc:${DOC})](https://example.com)`} />, {
        documents: [document(DOC, 'Il Cancello')],
      }),
    );

    const mention = screen.getByTestId('document-mention');
    expect(mention.tagName).not.toBe('A');
    expect(mention.closest('a')).toHaveAttribute('href', 'https://example.com');
  });
});
