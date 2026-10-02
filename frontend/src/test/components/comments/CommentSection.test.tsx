import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError } from '../../../lib/notify';
import { rawCharacter, rawComment, rawDocumentRead } from '../../fixtures';
import i18n from '../../../i18n';
import { renderWithProviders } from '../../utils';
import { CommentSection } from '../../../components/comments/CommentSection';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function member(overrides: Partial<Member> = {}): Member {
  return {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
    ...overrides,
  };
}

// Where the page records the visit once the Thread loads (spec 19b).
const READ = '/rooms/room-1/documents/doc-1/read';

// Answers the Comment list route with `list`, the caller's Characters with
// `characters`, and anything else (a write, an image attach) with `onWrite`.
// A test that only reads can omit it.
function mockRoutes(
  list: unknown[],
  onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(),
  characters: unknown[] = [],
  read: unknown = rawDocumentRead(),
) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/rooms/room-1/characters/mine') {
      return Promise.resolve(characters);
    }
    if (path === READ) {
      return Promise.resolve(read);
    }
    return path === '/rooms/room-1/documents/doc-1/comments' && !init?.method
      ? Promise.resolve(list)
      : onWrite(path);
  });
}

const members = [
  member(),
  member({ userId: 'user-2', displayName: 'Master', email: 'master@example.com' }),
];

function render() {
  renderWithProviders(
    <CommentSection roomId="room-1" documentId="doc-1" members={members} currentUserId="user-1" />,
  );
  return { user: userEvent.setup() };
}

const composer = () => screen.getByRole('textbox', { name: 'Testo del commento' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  localStorage.clear();
});

describe('CommentSection', () => {
  it('invites the first Comment when there are none', async () => {
    mockRoutes([]);
    render();

    expect(await screen.findByText(/Nessun commento ancora/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cerca nei commenti')).not.toBeInTheDocument();
  });

  it('lists the Comments with a count', async () => {
    mockRoutes([
      rawComment(),
      rawComment({ id: 'comment-2', body: 'Secondo', author_id: 'user-2' }),
    ]);
    render();

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // Not through `mockRoutes`: its list route always resolves, and this test
  // needs the load itself to fail.
  it('reports a failed load', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render();

    expect(await screen.findByText('Impossibile caricare i commenti.')).toBeInTheDocument();
  });

  it('posts a new Comment', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    await user.type(composer(), 'Ricordate il sigillo.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments', {
        method: 'POST',
        json: {
          body: 'Ricordate il sigillo.',
          visibility: 'room',
          selective_user_ids: [],
          as_document_id: null,
        },
      }),
    );
  });

  it('clears the composer once the Comment is saved', async () => {
    mockRoutes([]);

    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    await user.type(composer(), 'Ricordate il sigillo.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() => expect(composer()).toHaveValue(''));
  });

  it('marks the composer submitting while a new Comment saves', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    let resolvePost: (value: unknown) => void = () => {};
    mockRoutes([rawComment()], () => new Promise((resolve) => (resolvePost = resolve)));
    await user.type(composer(), 'Ricordate il sigillo.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    expect(screen.getByRole('button', { name: /Pubblica/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
    resolvePost(rawComment());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Pubblica/ })).not.toHaveAttribute(
        'data-loading',
        'true',
      ),
    );
  });

  // The composer's own "submitting" only ever means a *new* Comment is being
  // posted - an in-place edit uses the same mutation but must not light it up.
  it('does not mark the composer submitting while an in-place edit saves', async () => {
    let resolvePatch: (value: unknown) => void = () => {};
    mockRoutes([rawComment()], () => new Promise((resolve) => (resolvePatch = resolve)));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByText('Modifica'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(screen.getByRole('button', { name: /Pubblica/ })).not.toHaveAttribute(
      'data-loading',
      'true',
    );
    resolvePatch(rawComment());
    await waitFor(() => expect(screen.getByText('Modifica')).toBeInTheDocument());
  });

  it('reports a failed post', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    fetchMock.mockRejectedValue(new Error('Body cannot be blank'));
    await user.type(composer(), 'x');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // The Comment itself saved; only some images didn't. Losing the text
  // would be worse than reporting the partial failure.
  it('warns when the Comment saved but an image did not', async () => {
    mockRoutes([]);
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    mockRoutes([rawComment()], (path) =>
      path.includes('/images')
        ? Promise.reject(new Error('Too many images'))
        : Promise.resolve(rawComment()),
    );
    await user.click(screen.getByRole('button', { name: 'Aggiungi immagine da URL' }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await user.type(composer(), 'Con immagine');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Commento salvato, ma non tutte le immagini'),
        }),
      ),
    );
  });
});

describe('filtering', () => {
  async function renderWithComments() {
    mockRoutes([
      rawComment({ id: 'comment-1', body: 'Il sigillo', author_id: 'user-1' }),
      rawComment({ id: 'comment-2', body: 'La porta', author_id: 'user-2' }),
    ]);

    const handle = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
    return handle;
  }

  it('narrows the list by search and says how many are shown', async () => {
    const { user } = await renderWithComments();

    await user.type(screen.getByLabelText('Cerca nei commenti'), 'sigillo');

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    expect(screen.getByText('1 di 2 commenti')).toBeInTheDocument();
  });

  it('offers a way out when nothing matches', async () => {
    const { user } = await renderWithComments();

    await user.type(screen.getByLabelText('Cerca nei commenti'), 'niente');

    expect(await screen.findByText('Nessun commento corrisponde ai filtri.')).toBeInTheDocument();
    // Both the toolbar and the empty state offer a reset; the empty state's
    // is the one rendered second.
    await user.click(screen.getAllByRole('button', { name: /Azzera filtri/ }).at(-1)!);

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
  });

  it('updates an unknown author label when the language changes', async () => {
    mockRoutes([rawComment({ author_id: 'former-member' })]);
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByRole('combobox', { name: 'Filtra per autore' }));
    expect(screen.getByRole('option', { name: 'Utente sconosciuto' })).toBeInTheDocument();

    await i18n.changeLanguage('en');
    await user.click(screen.getByRole('combobox', { name: 'Filter by author' }));
    expect(await screen.findByRole('option', { name: 'Unknown user' })).toBeInTheDocument();
  });

  it('filters by author', async () => {
    const { user } = await renderWithComments();

    await user.click(screen.getByRole('combobox', { name: 'Filtra per autore' }));
    await user.click(screen.getByRole('option', { name: 'Master' }));

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    expect(screen.getByText('La porta')).toBeInTheDocument();
  });
});

describe('editing from the list', () => {
  it('saves an edit made in place', async () => {
    const writes: string[] = [];
    mockRoutes([rawComment()], (path) => {
      writes.push(path);
      return Promise.resolve(rawComment({ body: 'Nuovo testo' }));
    });
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByText('Modifica'));
    const editor = screen.getAllByRole('textbox', { name: 'Testo del commento' })[0];
    await user.clear(editor);
    await user.type(editor, 'Nuovo testo');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(writes).toContain('/rooms/room-1/documents/doc-1/comments/comment-1'),
    );
  });

  // The edit form closes only once the save succeeds, so a failure leaves
  // the text on screen to retry.
  it('closes the editor after a successful save', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(screen.getByText('Modifica')).toBeInTheDocument());
  });

  it('reports a rejected edit', async () => {
    mockRoutes([rawComment()], () => Promise.reject(new Error('Only the author can edit')));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});

describe('deleting from the list', () => {
  it('deletes the Comment the action belongs to', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    await user.click(screen.getByText('Elimina'));
    await user.click(screen.getAllByRole('button', { name: 'Elimina' }).at(-1)!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments/comment-1', {
        method: 'DELETE',
      }),
    );
  });

  it('reports a failed delete', async () => {
    mockRoutes([rawComment()], () => Promise.resolve(rawComment()));
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));

    fetchMock.mockRejectedValue(new Error('Only the author or the Master'));
    await user.click(screen.getByText('Elimina'));
    await user.click(screen.getAllByRole('button', { name: 'Elimina' }).at(-1)!);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // While one Comment's deletion is in flight, every other Comment in the
  // list is re-rendered too - each must compute its own `deleting` as false.
  it('only marks the Comment actually being deleted, leaving the rest alone', async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    mockRoutes(
      [rawComment(), rawComment({ id: 'comment-2', body: 'Secondo', author_id: 'user-2' })],
      () => new Promise((resolve) => (resolveDelete = resolve)),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));

    await user.click(screen.getAllByText('Elimina')[0]);
    // Only the trigger for comment-1's own popover is open, so exactly one
    // "Elimina" button isn't a list-row trigger (those carry `.comment-action`).
    const confirmButtons = screen
      .getAllByRole('button', { name: 'Elimina' })
      .filter((button) => !button.querySelector('.comment-action'));
    await user.click(confirmButtons[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments/comment-1', {
        method: 'DELETE',
      }),
    );
    expect(screen.getByText('Secondo')).toBeInTheDocument();
    resolveDelete(undefined);
  });
});

describe('posting in character', () => {
  const postAs = () => screen.getByRole('combobox', { name: 'Scrivi come' });

  it('offers no "Post as" to someone with no Character', async () => {
    mockRoutes([]);
    render();
    await screen.findByText(/Nessun commento ancora/);

    await waitFor(() => expect(composer()).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: 'Scrivi come' })).not.toBeInTheDocument();
  });

  it('writes as a Character and remembers the choice for the Room', async () => {
    const writes: unknown[] = [];
    fetchMock.mockImplementation((path: string, init?: { method?: string; json?: unknown }) => {
      if (path === '/rooms/room-1/characters/mine') {
        return Promise.resolve([rawCharacter()]);
      }
      if (path === READ) {
        return Promise.resolve(rawDocumentRead());
      }
      if (init?.method) {
        writes.push(init.json);
        return Promise.resolve(rawComment());
      }
      return Promise.resolve([]);
    });
    const { user } = render();
    await screen.findByText(/Nessun commento ancora/);

    expect(await screen.findByRole('combobox', { name: 'Scrivi come' })).toHaveValue(
      'Te stesso (Giocatore)',
    );
    await user.click(postAs());
    await user.click(screen.getByRole('option', { name: 'Aria' }));
    await user.type(composer(), 'Salve.');
    await user.click(screen.getByRole('button', { name: /Pubblica/ }));

    await waitFor(() => expect(localStorage.getItem('postAs:room-1')).toBe('doc-2'));
    expect(writes[0]).toEqual(expect.objectContaining({ as_document_id: 'doc-2' }));
    // The composer clears but keeps writing as Aria.
    await waitFor(() => expect(composer()).toHaveValue(''));
    expect(postAs()).toHaveValue('Aria');
  });

  it('starts on the Character last used in this Room', async () => {
    localStorage.setItem('postAs:room-1', 'doc-2');
    mockRoutes([], undefined, [rawCharacter()]);
    render();

    expect(await screen.findByRole('combobox', { name: 'Scrivi come' })).toHaveValue('Aria');
  });

  it('forgets a remembered Character the author may no longer write as', async () => {
    localStorage.setItem('postAs:room-1', 'doc-9');
    mockRoutes([], undefined, [rawCharacter()]);
    render();

    expect(await screen.findByRole('combobox', { name: 'Scrivi come' })).toHaveValue(
      'Te stesso (Giocatore)',
    );
  });

  it('shows the Character a Comment was written as', async () => {
    mockRoutes([rawComment({ as_character: rawCharacter() })]);
    render();

    expect(await screen.findByRole('link', { name: 'Aria' })).toBeInTheDocument();
  });
});

describe('CommentSection replies (spec 19)', () => {
  const replyBox = () => screen.getByRole('textbox', { name: /^Risposta a / });
  // The composer's submit button, not the Reply action that opened it.
  const sendReply = () =>
    screen
      .getAllByRole('button', { name: /^Rispondi/ })
      .find((b) => b.getAttribute('type') === 'submit')!;

  it('nests replies under what they answer and counts top-level Comments', async () => {
    mockRoutes([
      rawComment({ id: 'top', body: 'Chi va là?' }),
      rawComment({ id: 'answer', body: 'Un amico.', parent_id: 'top', author_id: 'user-2' }),
      rawComment({ id: 'other', body: 'Altro', author_id: 'user-2' }),
    ]);
    const { user } = render();
    await screen.findByText('Un amico.');

    const branches = screen.getAllByTestId('comment-branch');
    // The reply's branch sits inside its parent's.
    expect(branches[0]).toContainElement(screen.getByText('Un amico.'));
    await user.type(screen.getByLabelText('Cerca nei commenti'), 'Chi va');
    // One top-level Comment of two is shown, with its whole branch.
    expect(await screen.findByText('1 di 2 commenti')).toBeInTheDocument();
    expect(screen.getByText('Un amico.')).toBeInTheDocument();
  });

  // Decision 1: a fourth-level reply is drawn at the third, saying whom it answers.
  it('says whom a reply answers past the third level', async () => {
    mockRoutes([
      rawComment({ id: 'l1', body: 'Uno' }),
      rawComment({ id: 'l2', body: 'Due', parent_id: 'l1', author_id: 'user-2' }),
      rawComment({ id: 'l3', body: 'Tre', parent_id: 'l2' }),
      rawComment({ id: 'l4', body: 'Quattro', parent_id: 'l3', author_id: 'user-2' }),
    ]);
    render();

    expect(await screen.findByText('Quattro')).toBeInTheDocument();
    expect(screen.getByText('in risposta a Giocatore')).toBeInTheDocument();
    expect(screen.getAllByText(/^in risposta a/)).toHaveLength(1);
  });

  it('posts a reply that starts with the parent visibility', async () => {
    mockRoutes([rawComment({ id: 'top', author_id: 'user-2', body: 'Chi va là?' })]);
    const { user } = render();
    await user.click(await screen.findByText('Rispondi'));

    expect(replyBox()).toHaveAccessibleName('Risposta a Master');
    expect(screen.getAllByRole('combobox', { name: 'Visibilità del commento' })[0]).toHaveValue(
      'Stanza (tutti i membri)',
    );
    mockRoutes([rawComment({ id: 'top' })], () => Promise.resolve(rawComment({ id: 'r' })));
    await user.type(replyBox(), 'Un amico.');
    await user.click(sendReply());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/comments', {
        method: 'POST',
        json: {
          body: 'Un amico.',
          visibility: 'room',
          selective_user_ids: [],
          as_document_id: null,
          parent_id: 'top',
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /^Risposta a / })).toBeNull());
  });

  // VR-04: a reply to a narrower Comment is never offered Room, and starts
  // Selective to the people who read the parent.
  it('offers a reply to a narrower Comment only what fits inside it', async () => {
    mockRoutes([
      rawComment({
        id: 'top',
        author_id: 'user-2',
        visibility: 'selective',
        selective_user_ids: ['user-1'],
      }),
    ]);
    const { user } = render();
    await user.click(await screen.findByText('Rispondi'));

    const visibility = screen.getAllByRole('combobox', { name: 'Visibilità del commento' })[0];
    expect(visibility).toHaveValue('Selettivo (tu, Master e chi scegli)');
    await user.click(visibility);
    expect(screen.queryByRole('option', { name: 'Stanza (tutti i membri)' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Privato (tu + Master)' })).toBeInTheDocument();
  });

  it('closes the reply composer on cancel, and never offers Reply on a deleted Comment', async () => {
    mockRoutes([
      rawComment({ id: 'top' }),
      rawComment({ id: 'gone', deleted: true, body: '', can_edit: false, can_delete: false }),
    ]);
    const { user } = render();
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));

    expect(screen.getAllByText('Rispondi')).toHaveLength(1);
    await user.click(screen.getByText('Rispondi'));
    await user.click(screen.getAllByRole('button', { name: 'Annulla' })[0]);
    expect(screen.queryByRole('textbox', { name: /^Risposta a / })).toBeNull();
  });

  it('reports a failed reply and keeps the composer open', async () => {
    mockRoutes([rawComment({ id: 'top' })], () => Promise.reject(new Error('wider')));
    const { user } = render();
    await user.click(await screen.findByText('Rispondi'));
    await user.type(replyBox(), 'Psst.');
    await user.click(sendReply());

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(replyBox()).toBeInTheDocument();
  });

  // Editing a reply keeps to its parent's audience too.
  it("limits a reply's edit to its parent's visibility", async () => {
    mockRoutes([
      rawComment({ id: 'top', author_id: 'user-2', visibility: 'private', can_edit: false }),
      rawComment({ id: 'mine', parent_id: 'top', visibility: 'private', body: 'Segreto' }),
    ]);
    const { user } = render();
    await screen.findByText('Segreto');
    await user.click(screen.getByText('Modifica'));

    await user.click(screen.getAllByRole('combobox', { name: 'Visibilità del commento' })[0]);
    expect(screen.queryByRole('option', { name: 'Stanza (tutti i membri)' })).toBeNull();
  });
});

// Spec 19b: the visit is recorded once the Thread loads, and what was posted
// since the previous one is marked.
describe('new since the last visit', () => {
  const before = '2026-09-21T12:00:00Z';
  const after = '2026-09-22T12:00:00Z';
  const lastVisit = rawDocumentRead({ previous_read_at: '2026-09-22T00:00:00Z' });

  it('records the visit once and marks only what others posted since', async () => {
    mockRoutes(
      [
        rawComment({ id: 'old', author_id: 'user-2', body: 'Vecchio', created_at: before }),
        rawComment({ id: 'fresh', author_id: 'user-2', body: 'Fresco', created_at: after }),
        rawComment({ id: 'mine', body: 'Mio', created_at: after }),
      ],
      undefined,
      [],
      lastVisit,
    );
    render();

    const badge = await screen.findByText('Nuovo');
    expect(screen.getAllByText('Nuovo')).toHaveLength(1);
    expect(badge.closest('[data-testid="comment-item"]')).toHaveTextContent('Fresco');
    expect(fetchMock.mock.calls.filter(([path]) => path === READ)).toEqual([
      [READ, { method: 'POST' }],
    ]);
  });

  it('marks nothing on a first visit', async () => {
    mockRoutes([rawComment({ author_id: 'user-2', created_at: after })]);
    render();

    await screen.findByText('Ricordate il sigillo.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(READ, { method: 'POST' }));
    expect(screen.queryByText('Nuovo')).not.toBeInTheDocument();
  });

  it('opens a long branch hiding a new reply, and counts it once closed', async () => {
    const reply = (id: string, created_at = before) =>
      rawComment({ id, parent_id: 'top', author_id: 'user-2', body: `Risposta ${id}`, created_at });
    mockRoutes(
      [
        rawComment({ id: 'top', body: 'Domanda', created_at: before }),
        reply('r1'),
        reply('r2'),
        reply('r3'),
        reply('r4', after),
      ],
      undefined,
      [],
      lastVisit,
    );
    const { user } = render();

    // Four replies would start collapsed to two, but the fourth is new.
    expect(await screen.findByText('Risposta r4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nascondi risposte' }));

    expect(screen.queryByText('Risposta r4')).not.toBeInTheDocument();
    expect(screen.getByText('1 nuova')).toBeInTheDocument();
  });
});

describe('pinned and resolved (spec 19c)', () => {
  const COMMENTS = '/rooms/room-1/documents/doc-1/comments';

  // Decision 3: pinned Comments come first, oldest pin first, ahead of the
  // toolbar's newest-first sort.
  it('lists pinned Comments in their own section before the rest', async () => {
    mockRoutes([
      rawComment({ id: 'c-old', body: 'Vecchio', created_at: '2026-09-20T10:00:00Z' }),
      rawComment({
        id: 'c-pin-late',
        body: 'Fissato dopo',
        created_at: '2026-09-21T10:00:00Z',
        pinned_at: '2026-09-25T10:00:00Z',
      }),
      rawComment({
        id: 'c-pin-early',
        body: 'Fissato prima',
        created_at: '2026-09-19T10:00:00Z',
        pinned_at: '2026-09-24T10:00:00Z',
      }),
    ]);
    render();

    const section = await screen.findByRole('region', { name: 'Commenti fissati' });
    const pinnedBodies = within(section)
      .getAllByTestId('comment-item')
      .map((item) => item.textContent);
    expect(pinnedBodies[0]).toContain('Fissato prima');
    expect(pinnedBodies[1]).toContain('Fissato dopo');
    expect(within(screen.getByTestId('comment-list')).getByText('Vecchio')).toBeInTheDocument();
    expect(within(section).getAllByText('Fissato')).toHaveLength(2);
  });

  it('shows no pinned section when nothing is pinned', async () => {
    mockRoutes([rawComment()]);
    render();

    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    expect(screen.queryByTestId('pinned-comments')).not.toBeInTheDocument();
  });

  it('pins through the Comment action and shows the answer', async () => {
    const writes: string[] = [];
    mockRoutes([rawComment({ can_pin: true })], (path) => {
      writes.push(path);
      return Promise.resolve(rawComment({ can_pin: true, pinned_at: '2026-10-02T12:00:00Z' }));
    });
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Fissa' }));

    expect(await screen.findByRole('region', { name: 'Commenti fissati' })).toBeInTheDocument();
    expect(writes).toEqual([`${COMMENTS}/comment-1/pin`]);
    expect(fetchMock).toHaveBeenCalledWith(`${COMMENTS}/comment-1/pin`, { method: 'POST' });
    expect(screen.getByRole('button', { name: 'Togli dai fissati' })).toBeInTheDocument();
  });

  it('disables only the actions of the Comment being pinned', async () => {
    mockRoutes(
      [
        rawComment({ id: 'c-1', body: 'Uno', can_pin: true }),
        rawComment({ id: 'c-2', body: 'Due', can_pin: true }),
      ],
      () => new Promise(() => {}),
    );
    const { user } = render();

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Fissa' })).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: 'Fissa' })[0]);

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Fissa' }).map((b) => b.hasAttribute('disabled')),
      ).toEqual([true, false]),
    );
  });

  // Two changes on different Comments overlap: the first one's outcome still
  // counts once the second has started.
  it('handles overlapping changes on two Comments each on its own', async () => {
    const parent = rawComment({ id: 'c-1', body: 'Uno', can_resolve: true });
    const reply = rawComment({ id: 'c-2', body: "L'oste.", parent_id: 'c-1' });
    const other = rawComment({ id: 'c-3', body: 'Tre', can_pin: true });
    let finishResolve: (value: unknown) => void = () => {};
    let failPin: (error: Error) => void = () => {};
    mockRoutes([parent, reply, other], (path) =>
      path.endsWith('/resolve')
        ? new Promise((resolve) => {
            finishResolve = resolve;
          })
        : new Promise((_, reject) => {
            failPin = reject;
          }),
    );
    const { user } = render();

    expect(await screen.findByText("L'oste.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nascondi risposte' }));
    await user.click(screen.getByRole('button', { name: 'Mostra 1 risposta' }));
    await user.click(screen.getByRole('button', { name: 'Segna come risolto' }));
    await user.click(screen.getByRole('button', { name: 'Fissa' }));
    expect(screen.getByRole('button', { name: 'Segna come risolto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fissa' })).toBeDisabled();

    finishResolve({ ...parent, resolved_at: '2026-10-02T12:00:00Z', resolved_by: 'user-1' });
    failPin(new Error('Un Documento può avere al massimo 3 Commenti fissati'));

    // The resolve still collapses its branch, the pin's failure is reported.
    await waitFor(() => expect(screen.queryByText("L'oste.")).not.toBeInTheDocument());
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Fissa' })).toBeEnabled();
  });

  it('reports a refused pin', async () => {
    mockRoutes([rawComment({ can_pin: true })], () =>
      Promise.reject(new Error('Un Documento può avere al massimo 3 Commenti fissati')),
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Fissa' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });

  // Decision 4: a resolved branch starts collapsed and says it's resolved.
  it('collapses a resolved branch, and resolving one by hand collapses it', async () => {
    const parent = rawComment({ id: 'c-1', body: 'Chi ha la chiave?', can_resolve: true });
    const reply = rawComment({ id: 'c-2', body: "L'oste.", parent_id: 'c-1' });
    mockRoutes([parent, reply], () =>
      Promise.resolve({ ...parent, resolved_at: '2026-10-02T12:00:00Z', resolved_by: 'user-1' }),
    );
    const { user } = render();

    expect(await screen.findByText("L'oste.")).toBeInTheDocument();
    // Opened by hand first: resolving still collapses it.
    await user.click(screen.getByRole('button', { name: 'Nascondi risposte' }));
    await user.click(screen.getByRole('button', { name: 'Mostra 1 risposta' }));
    await user.click(screen.getByRole('button', { name: 'Segna come risolto' }));

    expect(await screen.findByText('Risolto')).toBeInTheDocument();
    expect(screen.queryByText("L'oste.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${COMMENTS}/c-1/resolve`, { method: 'POST' });
    expect(screen.getByRole('button', { name: 'Riapri' })).toBeInTheDocument();
    // Still reachable by hand.
    await user.click(screen.getByRole('button', { name: 'Mostra 1 risposta' }));
    expect(screen.getByText("L'oste.")).toBeInTheDocument();
  });

  it('reopens a resolved branch through the Comment action', async () => {
    const parent = rawComment({
      id: 'c-1',
      can_resolve: true,
      resolved_at: '2026-10-02T12:00:00Z',
      resolved_by: 'user-2',
    });
    const reply = rawComment({ id: 'c-2', body: "L'oste.", parent_id: 'c-1' });
    mockRoutes([parent, reply], () =>
      Promise.resolve({ ...parent, resolved_at: null, resolved_by: null }),
    );
    const { user } = render();

    expect(await screen.findByText('Risolto')).toBeInTheDocument();
    expect(screen.queryByText("L'oste.")).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Riapri' }));

    expect(await screen.findByText("L'oste.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${COMMENTS}/c-1/resolve`, { method: 'DELETE' });
  });
});
