import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentMentionsContext } from '../../hooks/useDocumentMentions';
import { notifyError } from '../../lib/notify';
import { renderWithProviders } from '../../test/utils';
import { MentionTextarea } from './MentionTextarea';
import type { DocumentMentionsValue } from '../../hooks/useDocumentMentions';
import type { Document } from '../../types/document';

vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

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
  };
}

const documents = [document('doc-1', 'Il Cancello'), document('doc-2', 'Il Castello')];
const tags = [{ id: 'tag-1', name: 'Luoghi', category: null }];

// Controlled, like every real caller: the popup depends on the value and
// the caret moving together.
function Harness({ onValue, initial = '' }: { onValue: (value: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      label="Descrizione"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function render(options: { context?: Partial<DocumentMentionsValue> | null; initial?: string } = {}) {
  const onValue = vi.fn();
  const create = vi.fn();
  const harness = <Harness onValue={onValue} initial={options.initial} />;

  if (options.context === null) {
    renderWithProviders(harness);
  } else {
    const value: DocumentMentionsValue = {
      roomId: 'room-1',
      documents,
      tags,
      canCreateDocument: true,
      canCreateTag: true,
      create,
      ...options.context,
    };
    renderWithProviders(
      <DocumentMentionsContext value={value}>{harness}</DocumentMentionsContext>,
    );
  }

  return { onValue, create, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: 'Descrizione' });
const plainField = () => screen.getByRole('textbox', { name: 'Descrizione' });

beforeEach(() => {
  vi.mocked(notifyError).mockClear();
});

describe('without a mentions context', () => {
  // Used on pages with no Room behind them; it must still be a usable field.
  it('behaves as a plain textarea', async () => {
    const { onValue, user } = render({ context: null });

    await user.type(plainField(), 'Solo testo #Il Cancello');

    expect(onValue).toHaveBeenLastCalledWith('Solo testo #Il Cancello');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is not announced as a combobox', () => {
    render({ context: null });

    expect(plainField()).not.toHaveAttribute('aria-autocomplete');
  });
});

describe('suggesting', () => {
  it('stays closed until a # is typed', async () => {
    const { user } = render();

    await user.type(field(), 'Una porta');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on #', async () => {
    const { user } = render();

    await user.type(field(), '#');

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
  });

  it('narrows the list as the name is typed', async () => {
    const { user } = render();

    await user.type(field(), '#Il Can');

    await waitFor(() => expect(screen.getByText('Il Cancello')).toBeInTheDocument());
    expect(screen.queryByText('Il Castello')).not.toBeInTheDocument();
  });

  it('suggests Tags as well as Documents', async () => {
    const { user } = render();

    await user.type(field(), '#Luo');

    expect(await screen.findByText('Luoghi')).toBeInTheDocument();
  });

  // A complete name stays open: it could still be the start of a longer one
  // ("Il Cancello Nero"), and names may contain spaces.
  it('stays open on a name that exactly matches a target', async () => {
    const { user } = render();

    await user.type(field(), '#Il Cancello');

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  // Once prose follows a known name, that `#` is a finished mention and
  // suggesting against the rest of the sentence would be noise.
  it('closes once prose follows a known name', async () => {
    const { user } = render();

    await user.type(field(), '#Il Cancello, poi');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

describe('picking a suggestion', () => {
  it('completes the mention on click', async () => {
    const { onValue, user } = render();
    await user.type(field(), '#Il Can');
    await screen.findByText('Il Cancello');

    await user.click(screen.getByText('Il Cancello'));

    expect(onValue).toHaveBeenLastCalledWith('#Il Cancello ');
  });

  it('completes on Enter', async () => {
    const { onValue, user } = render();
    await user.type(field(), '#Il Can');
    await screen.findByText('Il Cancello');

    await user.keyboard('{Enter}');

    expect(onValue).toHaveBeenLastCalledWith('#Il Cancello ');
  });

  it('moves through the list with the arrow keys', async () => {
    const { onValue, user } = render();
    await user.type(field(), '#Il');
    await screen.findByText('Il Cancello');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onValue).toHaveBeenLastCalledWith('#Il Castello ');
  });

  it('keeps the text around the mention', async () => {
    const { onValue, user } = render();
    await user.type(field(), 'Vai al #Il Can');
    await screen.findByText('Il Cancello');

    await user.keyboard('{Enter}');

    expect(onValue).toHaveBeenLastCalledWith('Vai al #Il Cancello ');
  });

  it('closes the popup after picking', async () => {
    const { user } = render();
    await user.type(field(), '#Il Can');
    await screen.findByText('Il Cancello');

    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  // Esc dismisses this mention only; it must not swallow the key forever.
  it('closes on Escape without changing the text', async () => {
    const { onValue, user } = render();
    await user.type(field(), '#Il Can');
    await screen.findByRole('listbox');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onValue).toHaveBeenLastCalledWith('#Il Can');
  });
});

describe('creating from the popup', () => {
  it('offers to create a name that matches nothing', async () => {
    const { user } = render();

    await user.type(field(), '#Tempio');

    expect(await screen.findByText(/Nessun risultato per «Tempio»/)).toBeInTheDocument();
  });

  it('creates a Document and completes the mention with it', async () => {
    const { onValue, create, user } = render();
    create.mockResolvedValue({ kind: 'document', document: document('doc-9', 'Tempio'), tags: [] });
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('document', 'Tempio'));
    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('#Tempio '));
  });

  it('creates a Tag when that kind is chosen', async () => {
    const { create, user } = render();
    create.mockResolvedValue({
      kind: 'tag',
      tag: { id: 'tag-9', name: 'Tempio', category: null },
      documentCount: 0,
    });
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: 'Tag' });

    await user.click(screen.getByRole('button', { name: 'Tag' }));
    await user.click(screen.getByRole('button', { name: /Crea Tag/ }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('tag', 'Tempio'));
  });

  // The UI only offers what the backend would allow.
  it('offers only Documents to someone who may not create Tags', async () => {
    const { user } = render({ context: { canCreateTag: false } });

    await user.type(field(), '#Tempio');

    await screen.findByRole('button', { name: /Crea Documento/ });
    expect(screen.queryByRole('button', { name: 'Tag' })).not.toBeInTheDocument();
  });

  it('offers nothing to create to someone who may create neither', async () => {
    const { user } = render({ context: { canCreateDocument: false, canCreateTag: false } });

    await user.type(field(), '#Tempio');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Crea/ })).not.toBeInTheDocument(),
    );
  });

  it('reports a failed creation and leaves the text alone', async () => {
    const { onValue, create, user } = render();
    create.mockRejectedValue(new Error('Only the Master can create Tags'));
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(onValue).toHaveBeenLastCalledWith('#Tempio');
  });
});
