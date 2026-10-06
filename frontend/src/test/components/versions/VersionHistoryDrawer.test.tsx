import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { rawVersion } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { VersionHistoryDrawer } from '../../../components/versions/VersionHistoryDrawer';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const DOC = '/rooms/room-1/documents/doc-1';

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

const members = [member('user-1', 'Alice'), member('user-2', 'Bruno')];

const newest = rawVersion({
  id: 'v2',
  title: 'Il Cancello Nero',
  edited_by: 'user-2',
  updated_at: '2026-10-05T13:00:00Z',
  words_added: 3,
  words_removed: 1,
});
const first = rawVersion({ id: 'v1', edited_by: 'user-1' });

const details: Record<string, unknown> = {
  v2: { ...newest, description: 'Un cancello di ferro nero.' },
  v1: { ...first, description: 'Un cancello di ferro.' },
};

interface Overrides {
  list?: unknown;
  failList?: boolean;
  failDetail?: boolean;
  failRestore?: boolean;
}

function mockApi(overrides: Overrides = {}) {
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return overrides.failRestore ? Promise.reject(new Error('No')) : Promise.resolve(details.v2);
    }
    if (path === `${DOC}/versions` || path === `${DOC}/notes/note-1/versions`) {
      return overrides.failList
        ? Promise.reject(new Error('No'))
        : Promise.resolve(overrides.list ?? [newest, first]);
    }
    if (overrides.failDetail) return Promise.reject(new Error('No'));
    return Promise.resolve(details[path.split('/').pop() as string]);
  });
}

function render(noteId?: string) {
  renderWithProviders(
    <VersionHistoryDrawer
      opened
      onClose={vi.fn()}
      roomId="room-1"
      documentId="doc-1"
      noteId={noteId}
      name="Il Cancello Nero"
      current={{ title: 'Il Cancello Nero', description: 'Un cancello di ferro nero.' }}
      members={members}
    />,
  );
  return { user: userEvent.setup() };
}

/** The button of the n-th row of the list (0 is the newest). */
async function row(index: number) {
  const items = await screen.findAllByRole('listitem');
  return within(items[index]).getByRole('button');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
  mockApi();
});

describe('the list', () => {
  it('shows who saved each version, the change size and which is current', async () => {
    render();

    const items = await screen.findAllByRole('listitem');

    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Bruno')).toBeInTheDocument();
    expect(within(items[0]).getByText('Attuale')).toBeInTheDocument();
    expect(within(items[0]).getByLabelText('Parole aggiunte: 3, tolte: 1')).toHaveTextContent(
      '+3 −1',
    );
    expect(within(items[1]).getByText('Alice')).toBeInTheDocument();
    expect(within(items[1]).getByText('Prima versione')).toBeInTheDocument();
    expect(
      screen.getByText('Scegli una versione per confrontarla con il testo attuale.'),
    ).toBeInTheDocument();
  });

  it("reads a Note's own history", async () => {
    render('note-1');

    await screen.findAllByRole('listitem');

    expect(fetchMock).toHaveBeenCalledWith(`${DOC}/notes/note-1/versions`);
  });

  it('says so when there is nothing', async () => {
    mockApi({ list: [] });
    render();

    expect(await screen.findByText('Nessuna versione.')).toBeInTheDocument();
  });

  it('says so when it cannot load', async () => {
    mockApi({ failList: true });
    render();

    expect(await screen.findByText('Impossibile caricare lo storico.')).toBeInTheDocument();
  });
});

// Spec 24 Decision 4: a version against the current text.
describe('comparing', () => {
  it('shows the chosen version beside the current text, differences marked', async () => {
    const { user } = render();

    await user.click(await row(1));

    const diff = await screen.findByTestId('version-diff');
    expect(within(diff).getByText('Questa versione')).toBeInTheDocument();
    expect(within(diff).getByText('Testo attuale')).toBeInTheDocument();
    const marked = Array.from(diff.querySelectorAll('mark')).map((m) => m.textContent?.trim());
    expect(marked).toEqual(['Nero', 'nero']);
  });

  it('says so, and offers no restore, for the text already in force', async () => {
    const { user } = render();

    await user.click(await row(0));

    expect(await screen.findByText('Questa è già la versione attuale.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ripristina questa versione' }),
    ).not.toBeInTheDocument();
  });

  it('shows a version with no description as such', async () => {
    details.v1 = { ...first, description: '' };
    const { user } = render();

    await user.click(await row(1));

    const diff = await screen.findByTestId('version-diff');
    expect(within(diff).getByText('Nessuna descrizione.')).toBeInTheDocument();
    details.v1 = { ...first, description: 'Un cancello di ferro.' };
  });

  it('says so when the version cannot load', async () => {
    mockApi({ failDetail: true });
    const { user } = render();

    await user.click(await row(1));

    await waitFor(() =>
      expect(screen.getByText('Impossibile caricare lo storico.')).toBeInTheDocument(),
    );
  });
});

// Spec 24 Decision 3: restoring adds a version, behind a confirmation.
describe('restoring', () => {
  async function chooseAndRestore(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await row(1));
    await user.click(await screen.findByRole('button', { name: 'Ripristina questa versione' }));
    return screen.findByRole('dialog', { name: 'Ripristinare questa versione?' });
  }

  it('asks first, then posts the restore and confirms', async () => {
    const { user } = render();

    const dialog = await chooseAndRestore(user);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/restore'),
      expect.anything(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Ripristina questa versione' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${DOC}/versions/v1/restore`, { method: 'POST' }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Versione ripristinata'));
    expect(
      screen.getByText('Scegli una versione per confrontarla con il testo attuale.'),
    ).toBeInTheDocument();
  });

  it('closes with Escape without restoring', async () => {
    const { user } = render();

    await chooseAndRestore(user);
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Ripristinare questa versione?' }),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/restore'),
      expect.anything(),
    );
  });

  it('can be cancelled without restoring', async () => {
    const { user } = render();

    const dialog = await chooseAndRestore(user);
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/restore'),
      expect.anything(),
    );
  });

  it('reports a refused restore', async () => {
    mockApi({ failRestore: true });
    const { user } = render();

    const dialog = await chooseAndRestore(user);
    await user.click(within(dialog).getByRole('button', { name: 'Ripristina questa versione' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(notifySuccess).not.toHaveBeenCalled();
  });
});
