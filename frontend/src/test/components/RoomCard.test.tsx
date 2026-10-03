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

async function openLeave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Azioni per la Stanza La Cripta' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Esci' }));
  return screen.findByRole('dialog', { name: 'Uscire da "La Cripta"?' });
}

describe('RoomCard', () => {
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

  // Spec 11: the setup page is reachable only by a Room Administrator.
  it('offers the setup page to an Administrator only', () => {
    render();
    expect(screen.queryByRole('link', { name: /Impostazioni/ })).not.toBeInTheDocument();
  });

  it('links an Administrator to the setup page', () => {
    render({ isAdmin: true });

    expect(screen.getByRole('link', { name: /Impostazioni/ })).toHaveAttribute(
      'href',
      '/rooms/room-1/setup',
    );
  });

  // Only an Administrator can invite (the backend rejects anyone else), so
  // the button is theirs alone.
  it('offers no invite to an ordinary member', () => {
    render();

    expect(screen.queryByRole('button', { name: /Invita/ })).not.toBeInTheDocument();
  });

  it('offers the invite to an Administrator', () => {
    render({ isAdmin: true });

    expect(screen.getByRole('button', { name: /Invita/ })).toBeInTheDocument();
  });

  it('opens the invite modal', async () => {
    const { user } = render({ isAdmin: true });

    await user.click(screen.getByRole('button', { name: /Invita/ }));

    expect(screen.getByRole('button', { name: 'Genera invito' })).toBeInTheDocument();
  });

  it('closes the invite modal again', async () => {
    const { user } = render({ isAdmin: true });
    await user.click(screen.getByRole('button', { name: /Invita/ }));

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Genera invito' })).not.toBeInTheDocument(),
    );
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
