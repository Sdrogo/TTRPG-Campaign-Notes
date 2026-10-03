import { useState, type FocusEvent, type KeyboardEvent } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentMentionsContext } from '../../../hooks/useDocumentMentions';
import { notifyError } from '../../../lib/notify';
import { renderWithProviders } from '../../utils';
import { MentionTextarea } from '../../../components/mentions/MentionTextarea';
import type { DocumentMentionsValue } from '../../../hooks/useDocumentMentions';
import type { Document } from '../../../types/document';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

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
  };
}

const documents = [document('doc-1', 'Il Cancello'), document('doc-2', 'Il Castello')];
const tags = [{ id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null }];

// Controlled, like every real caller: the popup depends on the value and
// the caret moving together.
function Harness({
  onValue,
  initial = '',
  onKeyDown,
  onBlur,
  members,
}: {
  onValue: (value: string) => void;
  initial?: string;
  members?: Member[];
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      label="Descrizione"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      members={members}
    />
  );
}

function render(
  options: {
    context?: Partial<DocumentMentionsValue> | null;
    initial?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
    members?: Member[];
  } = {},
) {
  const onValue = vi.fn();
  const create = vi.fn();
  const harness = (
    <Harness
      onValue={onValue}
      initial={options.initial}
      onKeyDown={options.onKeyDown}
      onBlur={options.onBlur}
      members={options.members}
    />
  );

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

  it('moves back up the list with ArrowUp', async () => {
    const { onValue, user } = render();
    await user.type(field(), '#Il');
    await screen.findByText('Il Cancello');

    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    expect(onValue).toHaveBeenLastCalledWith('#Il Cancello ');
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
      tag: { id: 'tag-9', name: 'Tempio', category: null, mainPosition: null },
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

  it('ignores a second click while the first creation is still in flight', async () => {
    const { create, user } = render();
    let resolveCreate: (value: unknown) => void = () => {};
    create.mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve)));
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');

    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate({ kind: 'document', document: document('doc-9', 'Tempio'), tags: [] });
  });

  // "Only replace what was typed if it's still there, unchanged" (the
  // component's own comment): editing the mention away while the request is
  // still in flight must not have the eventual result overwrite the edit.
  it('does not overwrite text edited away while the creation was in flight', async () => {
    const { create, user } = render();
    let resolveCreate: (value: unknown) => void = () => {};
    create.mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve)));
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));
    await user.clear(field());
    resolveCreate({ kind: 'document', document: document('doc-9', 'Tempio'), tags: [] });

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(field()).toHaveValue('');
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

// The popup's "create" row is reachable from the keyboard: ArrowDown moves
// onto it, the arrows switch kind, Enter creates.
describe('creating from the keyboard', () => {
  it('moves onto the create row and explains the shortcuts', async () => {
    const { user } = render();
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.keyboard('{ArrowDown}');

    expect(await screen.findByText(/Invio per creare/)).toBeInTheDocument();
  });

  it('creates on Enter once highlighted', async () => {
    const { create, user } = render();
    create.mockResolvedValue({ kind: 'document', document: document('doc-9', 'Tempio'), tags: [] });
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(create).toHaveBeenCalledWith('document', 'Tempio'));
  });

  it('switches kind with the arrows', async () => {
    const { create, user } = render();
    create.mockResolvedValue({
      kind: 'tag',
      tag: { id: 'tag-9', name: 'Tempio', category: null, mainPosition: null },
      documentCount: 0,
    });
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(await screen.findByRole('button', { name: /Crea Tag/ })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(create).toHaveBeenCalledWith('tag', 'Tempio'));
  });

  it('steps back off the create row', async () => {
    const { user } = render();
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });
    await user.keyboard('{ArrowDown}');
    await screen.findByText(/Invio per creare/);

    await user.keyboard('{ArrowUp}');

    await waitFor(() => expect(screen.queryByText(/Invio per creare/)).not.toBeInTheDocument());
  });

  // Enter is a newline until the user has actually moved onto the row.
  it('leaves Enter alone while the row is not highlighted', async () => {
    const { create, onValue, user } = render();
    await user.type(field(), '#Tempio');
    await screen.findByRole('button', { name: /Crea Documento/ });

    await user.keyboard('{Enter}');

    expect(create).not.toHaveBeenCalled();
    expect(onValue).toHaveBeenLastCalledWith('#Tempio\n');
  });
});

describe('forwarding the caller\'s own handlers', () => {
  it('still calls onKeyDown for a key the popup does not act on', async () => {
    const onKeyDown = vi.fn();
    const { user } = render({ onKeyDown });

    await user.type(field(), 'a');

    expect(onKeyDown).toHaveBeenCalled();
  });

  it('still calls onBlur when the field loses focus', async () => {
    const onBlur = vi.fn();
    const { user } = render({ onBlur });
    await user.click(field());

    await user.tab();

    expect(onBlur).toHaveBeenCalled();
  });
});

describe('tracking the caret', () => {
  // A range selection (not a plain caret) means there's nowhere for a
  // mention to start from, so the popup stays shut.
  it('closes the popup once the caret becomes a range selection', async () => {
    render({ initial: '#Il Can and more' });
    const textarea = field() as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(3, 3);
    fireEvent.select(textarea);
    await screen.findByRole('listbox');

    textarea.setSelectionRange(0, 5);
    fireEvent.select(textarea);

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

// Spec 19c: `@` suggests the Room's members; a picked one is stored as a
// token and shown as `@Name`.
describe('mentioning members', () => {
  const ARA = '11111111-1111-4111-8111-111111111111';
  const BRUNO = '22222222-2222-4222-8222-222222222222';
  const member = (userId: string, displayName: string): Member => ({
    userId,
    role: 'player',
    isAdmin: false,
    email: null,
    displayName,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  });
  const members = [member(ARA, 'Ara'), member(BRUNO, 'Bruno')];
  const ara = `@[Ara](user:${ARA})`;

  it('suggests members on @, even outside a mentions context', async () => {
    const { user } = render({ context: null, members });

    await user.type(field(), 'Ciao @');

    expect(await screen.findByRole('listbox', { name: 'Membri da menzionare' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('does not suggest Documents on # without a mentions context', async () => {
    const { user } = render({ context: null, members });

    await user.type(field(), '#Il');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('stores a picked member as a token and shows @Name', async () => {
    const { onValue, user } = render({ members });
    await user.type(field(), 'Ciao @ar');
    await screen.findByText('Ara');

    await user.keyboard('{Enter}');

    expect(onValue).toHaveBeenLastCalledWith(`Ciao ${ara} `);
    expect(field()).toHaveValue('Ciao @Ara ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps the token while typing after it', async () => {
    const { onValue, user } = render({ members });
    await user.type(field(), '@Br');
    await user.click(await screen.findByText('Bruno'));

    await user.type(field(), 'vieni');

    expect(onValue).toHaveBeenLastCalledWith(`@[Bruno](user:${BRUNO}) vieni`);
  });

  it('shows a stored token as @Name and unlinks it when the name is edited', async () => {
    const { onValue, user } = render({ members, initial: `${ara} ciao` });
    expect(field()).toHaveValue('@Ara ciao');

    // Caret right after "@Ara", then delete its last letter.
    await user.click(field());
    fireEvent.select(field(), { target: { selectionStart: 4, selectionEnd: 4 } });
    await user.keyboard('{Backspace}');

    expect(onValue).toHaveBeenLastCalledWith('@Ar ciao');
  });

  it('keeps a mention when typing right before it', async () => {
    const { onValue, user } = render({ members, initial: ara });

    await user.type(field(), '@', { initialSelectionStart: 0, initialSelectionEnd: 0 });

    expect(onValue).toHaveBeenLastCalledWith(`@${ara}`);
  });

  it('closes once prose follows a member name', async () => {
    const { user } = render({ members });

    await user.type(field(), '@Ara dice');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('offers nothing to create for an unknown member', async () => {
    const { user } = render({ members });

    await user.type(field(), '@Zeta');

    expect(await screen.findByText('Nessun risultato')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crea/ })).not.toBeInTheDocument();
  });

  it('still completes # mentions as plain text, next to member tokens', async () => {
    const { onValue, user } = render({ members, initial: `${ara} ` });

    await user.type(field(), '#Il Can');
    await user.click(await screen.findByText('Il Cancello'));

    expect(onValue).toHaveBeenLastCalledWith(`${ara} #Il Cancello `);
  });

  it('creates a Document from # while members are on', async () => {
    const { onValue, create, user } = render({ members, initial: `${ara} ` });
    create.mockResolvedValue({ kind: 'document', document: document('doc-9', 'Tempio'), tags: [] });
    await user.type(field(), '#Tempio');

    await user.click(await screen.findByRole('button', { name: /Crea Documento/ }));

    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith(`${ara} #Tempio `));
  });
});
