import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { renderWithProviders } from '../utils';
import { RoomCard } from '../../components/RoomCard';
import type { MyRoom } from '../../types/room';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

function myRoom(overrides: Partial<MyRoom> = {}): MyRoom {
  return {
    room: {
      id: 'room-1',
      name: 'La Cripta',
      gameSystem: 'D&D 5e',
      status: 'active',
      playersCanCreateDocuments: true,
      defaultVisibility: 'room',
      imageUrl: null,
    },
    role: 'player',
    isAdmin: false,
    ...overrides,
  };
}

function render(overrides: Partial<MyRoom> = {}) {
  renderWithProviders(<RoomCard myRoom={myRoom(overrides)} currentUserId="me" />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
  await screen.findByRole('menuitem', { name: 'Esci' });
}

async function openLeave(user: ReturnType<typeof userEvent.setup>) {
  await openMenu(user);
  await user.click(await screen.findByRole('menuitem', { name: 'Esci' }));
  return screen.findByRole('dialog', { name: 'Uscire da "La Cripta"?' });
}

describe('RoomCard', () => {
  // Spec 26: the Room image fills the card's right half, like a DocumentCard's.
  it('shows the Room image when it has one', () => {
    render({
      room: { ...myRoom().room, imageUrl: 'http://signed/rooms/room-1/a.webp' },
    });

    expect(screen.getByRole('img', { name: 'La Cripta' })).toHaveAttribute(
      'src',
      'http://signed/rooms/room-1/a.webp',
    );
  });

  it('shows no image without one', () => {
    render();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the Room name, system and role', () => {
    render();

    expect(screen.getByText('La Cripta')).toBeInTheDocument();
    expect(screen.getByText('D&D 5e')).toBeInTheDocument();
    expect(screen.getByText('Player')).toBeInTheDocument();
  });

  it('omits the system line when the Room has none', () => {
    render({ room: { ...myRoom().room, gameSystem: null } });

    expect(screen.queryByText('D&D 5e')).not.toBeInTheDocument();
  });

  it('links the whole card to the Documents page, with no separate button', () => {
    render();

    expect(screen.getByRole('link', { name: 'La Cripta' })).toHaveAttribute(
      'href',
      '/rooms/room-1/documents',
    );
    expect(screen.queryByRole('link', { name: /Documenti/ })).not.toBeInTheDocument();
  });

  // Spec 33: every action is an item of the one ⋮ menu, shown only to whoever
  // may use it.
  it('has a single actions button and no other button on the card', () => {
    render({ isAdmin: true, role: 'master' });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['a Player', { role: 'player' as const, isAdmin: false }, []],
    ['a Master', { role: 'master' as const, isAdmin: false }, ['Impostazioni', 'Duplica']],
    ['an Administrator', { role: 'player' as const, isAdmin: true }, ['Impostazioni', 'Invita']],
    [
      'a Master and Administrator',
      { role: 'master' as const, isAdmin: true },
      ['Impostazioni', 'Invita', 'Duplica'],
    ],
  ])('lists the actions %s may use', async (_who, overrides, expected) => {
    const { user } = render(overrides);

    await openMenu(user);

    const names = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(names).toEqual([...expected, 'Esci']);
  });

  it('links Setup in the menu to the setup page', async () => {
    const { user } = render({ isAdmin: true });

    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Impostazioni' })).toHaveAttribute(
      'href',
      '/rooms/room-1/setup',
    );
  });

  it('opens the invite modal from the menu', async () => {
    const { user } = render({ isAdmin: true });
    await openMenu(user);

    await user.click(screen.getByRole('menuitem', { name: 'Invita' }));

    expect(await screen.findByRole('button', { name: 'Genera invito' })).toBeInTheDocument();
  });

  it('closes the invite modal again', async () => {
    const { user } = render({ isAdmin: true });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Invita' }));
    await screen.findByRole('button', { name: 'Genera invito' });

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Genera invito' })).not.toBeInTheDocument(),
    );
  });

  describe('Duplicate (spec 33)', () => {
    async function openDuplicate(user: ReturnType<typeof userEvent.setup>) {
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Duplica' }));
      return screen.findByRole('dialog', { name: 'Duplicare "La Cripta"?' });
    }

    it('names the copy and says what is not copied', async () => {
      const { user } = render({ role: 'master' });

      const dialog = await openDuplicate(user);

      expect(within(dialog).getByText(/Commenti, Allegati PDF e membri no/)).toBeInTheDocument();
      expect(within(dialog).getByText('La Cripta (Copia)')).toBeInTheDocument();
    });

    it('duplicates the Room, confirms with the copy name and closes', async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        room: {
          id: 'room-2',
          name: 'La Cripta (Copia)',
          game_system: 'D&D 5e',
          status: 'active',
          players_can_create_documents: true,
          default_visibility: 'room',
          image_url: null,
        },
        role: 'master',
        is_admin: true,
      });
      const { user } = render({ role: 'master' });
      const dialog = await openDuplicate(user);

      await user.click(within(dialog).getByRole('button', { name: 'Duplica' }));

      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1/duplicate', {
          method: 'POST',
        }),
      );
      expect(notifySuccess).toHaveBeenCalledWith('Creata "La Cripta (Copia)"');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('cancels without duplicating', async () => {
      const { user } = render({ role: 'master' });
      const dialog = await openDuplicate(user);

      await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("shows the backend's refusal and stays open", async () => {
      const refusal = new ApiError(403, 'Solo il Master può duplicare la Stanza');
      vi.mocked(apiFetch).mockRejectedValue(refusal);
      const { user } = render({ role: 'master' });
      const dialog = await openDuplicate(user);

      await user.click(within(dialog).getByRole('button', { name: 'Duplica' }));

      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(refusal);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(notifySuccess).not.toHaveBeenCalled();
    });
  });

  // Spec 15: every member can leave from the card, whatever their role.
  it.each([
    ['a Player', { role: 'player' as const, isAdmin: false }],
    ['a Master', { role: 'master' as const, isAdmin: false }],
    ['an Administrator', { role: 'player' as const, isAdmin: true }],
  ])('offers Leave to %s', async (_who, overrides) => {
    const { user } = render(overrides);

    expect(await openLeave(user)).toBeInTheDocument();
  });

  it('opens the menu above the card link, without following it', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));

    expect(await screen.findByRole('menuitem', { name: 'Esci' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'La Cripta' })).toBeInTheDocument();
  });

  it('says the content stays and an invite is needed to come back', async () => {
    const { user } = render();

    const dialog = await openLeave(user);

    expect(within(dialog).getByText(/restano nella Stanza/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Sei un Amministratore/)).not.toBeInTheDocument();
  });

  it('points an Administrator at the setup page to name a successor', async () => {
    const { user } = render({ isAdmin: true });

    const dialog = await openLeave(user);

    expect(within(dialog).getByText(/Sei un Amministratore/)).toBeInTheDocument();
  });

  it('cancels without leaving', async () => {
    const { user } = render();
    const dialog = await openLeave(user);

    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("removes the user's own membership and confirms", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);
    const { user } = render();
    const dialog = await openLeave(user);

    await user.click(within(dialog).getByRole('button', { name: 'Esci' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/rooms/room-1/members/me', { method: 'DELETE' }),
    );
    expect(notifySuccess).toHaveBeenCalledWith('Hai lasciato "La Cripta"');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // The last-Master/last-Administrator rule is the backend's (D-16): its text
  // is shown and the modal stays open.
  it("shows the backend's refusal and stays open", async () => {
    const refusal = new ApiError(409, 'Una Stanza deve avere almeno un Master');
    vi.mocked(apiFetch).mockRejectedValue(refusal);
    const { user } = render({ role: 'master' });
    const dialog = await openLeave(user);

    await user.click(within(dialog).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(refusal);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(notifySuccess).not.toHaveBeenCalled();
  });
});
