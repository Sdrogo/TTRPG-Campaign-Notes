import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { rawComment, rawDocument } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import {
  PromoteToDocumentModal,
  WideningConfirmModal,
} from '../../../components/comments/CommentPromotion';
import type { Comment } from '../../../types/comment';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const BASE = '/rooms/room-1/documents';

function member(userId: string, displayName: string): Member {
  return {
    userId,
    role: 'player',
    isAdmin: false,
    email: null,
    displayName,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    documentId: 'doc-1',
    authorId: 'user-2',
    body: 'Il sigillo è rotto.',
    visibility: 'private',
    selectiveUserIds: [],
    createdAt: '2026-10-02T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
    deleted: false,
    images: [
      { id: 'img-1', url: 'https://cdn.example/1.png', isFavorite: false },
      { id: 'img-2', url: 'https://cdn.example/2.png', isFavorite: false },
    ],
    canEdit: false,
    canDelete: false,
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    reactions: [],
    pinnedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    canPin: false,
    canResolve: false,
    promotedAt: null,
    promotedTo: null,
    promotedDocumentId: null,
    canPromote: true,
    ...overrides,
  } as Comment;
}

interface Calls {
  importFails?: unknown[];
  createFails?: boolean;
  promoteFails?: boolean;
}

function mockApi({ importFails = [], createFails = false, promoteFails = false }: Calls = {}) {
  fetchMock.mockImplementation((path: string, init?: { method?: string; json?: unknown }) => {
    if (path === '/rooms/room-1/tags') {
      return Promise.resolve(init?.method ? { id: 'tag-9', name: 'Fazione', category: null } : []);
    }
    if (path === BASE && init?.method === 'POST') {
      return createFails
        ? Promise.reject(new Error('Only the Master can create Documents'))
        : Promise.resolve(rawDocument({ id: 'doc-9', name: 'Il Sigillo' }));
    }
    if (path === `${BASE}/doc-9/images/from-url`) {
      const url = (init?.json as { url?: string } | undefined)?.url ?? '';
      if (url === 'https://cdn.example/1.png' && importFails.includes('non-error')) {
        return Promise.reject('Timed out');
      }
      return importFails.includes(url)
        ? Promise.reject(new Error('Image not reachable'))
        : Promise.resolve(rawDocument({ id: 'doc-9' }));
    }
    if (promoteFails) return Promise.reject(new Error('The Comment was deleted'));
    return Promise.resolve(
      rawComment({ promoted_to: 'document', promoted_document_id: 'doc-9', can_promote: true }),
    );
  });
}

function render(reached: Member[] = [], canManageTags = false) {
  const onClose = vi.fn();
  const reachedBy = vi.fn(() => reached);
  renderWithProviders(
    <PromoteToDocumentModal
      roomId="room-1"
      documentId="doc-1"
      comment={comment()}
      currentUserId="user-1"
      canManageTags={canManageTags}
      reachedBy={reachedBy}
      onClose={onClose}
    />,
  );
  return { onClose, reachedBy, user: userEvent.setup() };
}

const nameField = () => screen.getByRole('textbox', { name: /^Nome/ });
const submit = () => screen.getByRole('button', { name: 'Crea Documento' });
const promoteCall = () =>
  fetchMock.mock.calls.find(([path]) => path === `${BASE}/doc-1/comments/comment-1/promote`);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  mockApi();
});

describe('WideningConfirmModal', () => {
  it('names who the text would newly reach and waits for a choice', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <WideningConfirmModal
        opened
        reached={[member('user-2', 'Ara'), member('user-3', 'Bruno')]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();

    expect(screen.getByText(/chi ora non lo vede: Ara, Bruno\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onCancel).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Promuovi comunque' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('PromoteToDocumentModal', () => {
  it("starts from the Comment's text, at a visibility that widens nothing", async () => {
    const { reachedBy } = render();

    expect(
      screen.getByRole('dialog', { name: 'Promuovi in un nuovo Documento' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Descrizione/ })).toHaveValue('Il sigillo è rotto.');
    // Its creator is the new Document's only Owner.
    expect(reachedBy).toHaveBeenCalledWith({
      visibility: 'private',
      ownerIds: ['user-1'],
      selectiveUserIds: [],
    });
    expect(submit()).toBeDisabled();
  });

  it('creates the Document, copies the chosen images and records the promotion', async () => {
    const { onClose, user } = render();
    await user.type(nameField(), 'Il Sigillo');
    // The second image is left out.
    await user.click(screen.getByRole('checkbox', { name: /Immagine 2/ }));

    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      json: expect.objectContaining({
        name: 'Il Sigillo',
        description: 'Il sigillo è rotto.',
        visibility: 'private',
      }),
    });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/doc-9/images/from-url`, {
      method: 'POST',
      json: { url: 'https://cdn.example/1.png' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(`${BASE}/doc-9/images/from-url`, {
      method: 'POST',
      json: { url: 'https://cdn.example/2.png' },
    });
    expect(promoteCall()?.[1]).toEqual({
      method: 'POST',
      json: { target: 'document', document_id: 'doc-9', confirm_widening: false },
    });
    expect(notifySuccess).toHaveBeenCalledWith('Commento promosso');
  });

  it('asks before creating a Document that widens who reads the text', async () => {
    const { onClose, user } = render([member('user-3', 'Bruno')]);
    await user.type(nameField(), 'Il Sigillo');

    await user.click(submit());
    const dialog = await screen.findByRole('dialog', {
      name: 'Il testo diventerà visibile a più persone',
    });
    expect(fetchMock).not.toHaveBeenCalledWith(BASE, expect.anything());

    // Backing out keeps the form.
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: 'Promuovi comunque' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(promoteCall()?.[1]).toMatchObject({ json: { confirm_widening: true } });
  });

  it('still promotes when an image could not be copied, and says which', async () => {
    mockApi({ importFails: ['non-error', 'https://cdn.example/2.png'] });
    const { onClose, user } = render();
    await user.type(nameField(), 'Il Sigillo');

    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(promoteCall()).toBeDefined();
    expect(notifyError).toHaveBeenCalledWith(
      new Error(
        'Commento promosso, ma alcune immagini non sono state aggiunte: Timed out; Image not reachable',
      ),
    );
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('reports a refused creation and keeps the form open', async () => {
    mockApi({ createFails: true });
    const { onClose, user } = render();
    await user.type(nameField(), 'Il Sigillo');

    await user.click(submit());

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(new Error('Only the Master can create Documents')),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(promoteCall()).toBeUndefined();
  });

  // The Document exists by then: a retry from the same form would make another.
  it('closes once the Document exists, even when the promotion is refused', async () => {
    mockApi({ promoteFails: true });
    const { onClose, user } = render();
    await user.type(nameField(), 'Il Sigillo');

    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(notifyError).toHaveBeenCalledWith(
      new Error(
        'Il Documento è stato creato, ma la promozione del commento non è stata registrata: The Comment was deleted',
      ),
    );
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('offers no images for a Comment without any', () => {
    renderWithProviders(
      <PromoteToDocumentModal
        roomId="room-1"
        documentId="doc-1"
        comment={comment({ images: [], visibility: 'room' })}
        currentUserId="user-1"
        canManageTags={false}
        reachedBy={() => []}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  // Guards the handler itself, not just the disabled button.
  it('drops a submission while a Tag is still being created', async () => {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
      path === '/rooms/room-1/tags' && init?.method ? new Promise(() => {}) : Promise.resolve([]),
    );
    const { user } = render([], true);
    await user.type(nameField(), 'Il Sigillo');
    const tagField = screen.getByRole('textbox', { name: 'Nuovo tag' });
    await user.type(tagField, 'Fazione');
    const tagGroup = tagField.closest('.mantine-Group-root') as HTMLElement;
    await user.click(within(tagGroup).getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(submit()).toBeDisabled());

    fireEvent.submit(nameField().closest('form') as HTMLFormElement);

    expect(fetchMock).not.toHaveBeenCalledWith(BASE, expect.anything());
  });
});
