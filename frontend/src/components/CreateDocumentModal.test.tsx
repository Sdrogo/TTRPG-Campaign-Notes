import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { rawDocument } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { CreateDocumentModal } from './CreateDocumentModal';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

// Creating a Tag invalidates the Tag list, so the modal refetches it while
// the test is still running: the mock has to answer per route, or the list
// comes back as the created Tag and the Tag picker breaks.
const routes = {
  tags: [{ id: 'tag-1', name: 'Luoghi', category: null }] as unknown,
  createTag: { id: 'tag-9', name: 'Fazione', category: null } as unknown,
  createDocument: rawDocument() as unknown,
};

function render(canManageTags = true) {
  const onClose = vi.fn();
  renderWithProviders(
    <CreateDocumentModal opened onClose={onClose} roomId="room-1" canManageTags={canManageTags} />,
  );
  return { onClose, user: userEvent.setup() };
}

const nameField = () => screen.getByRole('textbox', { name: /^Nome/ });
const tagField = () => screen.getByRole('textbox', { name: 'Nuovo tag' });
const submit = () => screen.getByRole('button', { name: 'Crea Documento' });
const addTag = () => screen.getByRole('button', { name: /Aggiungi/ });
const tagsLoaded = () => waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags'));

beforeEach(() => {
  routes.tags = [{ id: 'tag-1', name: 'Luoghi', category: null }];
  routes.createTag = { id: 'tag-9', name: 'Fazione', category: null };
  routes.createDocument = rawDocument();
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith('/tags')) {
      return init?.method === 'POST'
        ? Promise.resolve(routes.createTag)
        : Promise.resolve(routes.tags);
    }
    return Promise.resolve(routes.createDocument);
  });
});

describe('CreateDocumentModal', () => {
  it("loads the Room's Tags when opened", async () => {
    render();

    await tagsLoaded();
  });

  it('cannot submit without a name', () => {
    render();

    expect(submit()).toBeDisabled();
  });

  it('creates the Document with its fields', async () => {
    const { user } = render();
    await tagsLoaded();

    await user.type(nameField(), 'Il Cancello');
    await user.click(submit());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents', {
        method: 'POST',
        json: {
          name: 'Il Cancello',
          description: '',
          visibility: 'room',
          tag_ids: [],
          selective_user_ids: undefined,
        },
      }),
    );
  });

  it('closes once the Document is created', async () => {
    const { onClose, user } = render();
    await tagsLoaded();

    await user.type(nameField(), 'Il Cancello');
    await user.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reports a failure and stays open', async () => {
    const { onClose, user } = render();
    await tagsLoaded();

    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/tags')
        ? Promise.resolve(routes.tags)
        : Promise.reject(new Error('Players cannot create Documents here')),
    );
    await user.type(nameField(), 'Il Cancello');
    await user.click(submit());

    await waitFor(() =>
      expect(screen.getByText(/Players cannot create Documents here/)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('adding a Tag inline', () => {
  // Spec 10: only an Administrator or the Master may create a Tag
  // (`POST /rooms/{id}/tags`); a Player must not be offered a form the
  // backend would reject with a 403.
  it('is hidden from a viewer who may not manage Tags', () => {
    render(false);

    expect(screen.queryByRole('textbox', { name: 'Nuovo tag' })).not.toBeInTheDocument();
  });

  it('cannot add a blank Tag', () => {
    render();

    expect(addTag()).toBeDisabled();
  });

  it('creates the Tag and selects it on the Document', async () => {
    const { user } = render();
    await tagsLoaded();

    await user.type(tagField(), 'Fazione');
    await user.click(addTag());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
        method: 'POST',
        json: { name: 'Fazione', category: null },
      }),
    );

    // The new Tag is carried onto the Document being created.
    await user.type(nameField(), 'Il Cancello');
    await user.click(submit());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/rooms/room-1/documents',
        expect.objectContaining({ json: expect.objectContaining({ tag_ids: ['tag-9'] }) }),
      ),
    );
  });

  it('clears the Tag field after adding', async () => {
    const { user } = render();
    await tagsLoaded();

    await user.type(tagField(), 'Fazione');
    await user.click(addTag());

    await waitFor(() => expect(tagField()).toHaveValue(''));
  });

  // Submitting mid-creation would drop the Tag that is about to exist.
  it('blocks submitting while a Tag is still being created', async () => {
    const { user } = render();
    await tagsLoaded();

    fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
      path.endsWith('/tags') && init?.method === 'POST'
        ? new Promise(() => {})
        : Promise.resolve(routes.tags),
    );
    await user.type(nameField(), 'Il Cancello');
    await user.type(tagField(), 'Fazione');
    await user.click(addTag());

    await waitFor(() => expect(submit()).toBeDisabled());
  });
});
