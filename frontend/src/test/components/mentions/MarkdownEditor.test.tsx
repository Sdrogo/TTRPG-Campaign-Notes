import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import { renderWithProviders } from '../../utils';
import { MarkdownEditor } from '../../../components/mentions/MarkdownEditor';
import type { Document } from '../../../types/document';

const CANCELLO = '11111111-1111-4111-8111-111111111111';
const cancello = `#[Il Cancello](doc:${CANCELLO})`;

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

const mentions: DocumentMentionsValue = {
  roomId: 'room-1',
  documents: [document(CANCELLO, 'Il Cancello')],
  tags: [],
  canCreateDocument: false,
  canCreateTag: false,
  create: async () => {
    throw new Error('not used');
  },
};

function Harness({ initial, onValue }: { initial: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <DocumentMentionsContext value={mentions}>
      <MarkdownEditor
        label="Descrizione"
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue(next);
        }}
      />
    </DocumentMentionsContext>
  );
}

function render(initial = '') {
  const values: string[] = [];
  const result = renderWithProviders(<Harness initial={initial} onValue={(value) => values.push(value)} />);
  return { ...result, values, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: 'Descrizione' });

describe('MarkdownEditor', () => {
  it('wraps the selection in bold and keeps a mention token inside it', async () => {
    const { user, values } = render(`Vai al ${cancello} ora`);
    const textarea = field() as HTMLTextAreaElement;
    // What the textarea shows: `Vai al #Il Cancello ora`.
    textarea.setSelectionRange(7, 19);

    await user.click(screen.getByRole('button', { name: 'Grassetto' }));

    expect(values.at(-1)).toBe(`Vai al **${cancello}** ora`);
    await waitFor(() => expect(textarea.value).toBe('Vai al **#Il Cancello** ora'));
  });

  it('applies Ctrl+B', async () => {
    const { values } = render('forte');
    const textarea = field() as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);

    fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });

    expect(values.at(-1)).toBe('**forte**');
  });

  it('turns lines into a list', async () => {
    const { user, values } = render('uno\ndue');
    (field() as HTMLTextAreaElement).setSelectionRange(0, 7);

    await user.click(screen.getByRole('button', { name: 'Elenco puntato' }));

    expect(values.at(-1)).toBe('- uno\n- due');
  });

  it('previews the text as it will read', async () => {
    const { user } = render('## Luoghi\n\n**forte**');

    await user.click(screen.getByText('Anteprima'));

    const preview = screen.getByTestId('markdown-preview');
    expect(preview.querySelector('h4')).toHaveTextContent('Luoghi');
    expect(preview.querySelector('strong')).toHaveTextContent('forte');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

    await user.click(screen.getByText('Scrivi'));
    expect(field()).toHaveValue('## Luoghi\n\n**forte**');
  });

  it('says when there is nothing to preview', async () => {
    const { user } = render('  ');

    await user.click(screen.getByText('Anteprima'));

    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Ancora niente da mostrare.');
  });

  it('opens no suggestions for a # starting a heading', async () => {
    const { user } = render();

    await user.type(field(), '##');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.type(field(), ' Il');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('still suggests for a # in the middle of a line', async () => {
    const { user } = render();

    await user.type(field(), 'vai al #Il');

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('opens the cheat sheet', async () => {
    const { user } = render();

    await user.click(screen.getByTestId('markdown-help'));

    expect(await screen.findByText('Promemoria Markdown')).toBeInTheDocument();
  });
});
