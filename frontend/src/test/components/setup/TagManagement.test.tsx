import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { renderWithProviders } from '../../utils';
import { TagManagement } from '../../../components/setup/TagManagement';
import type { Tag } from '../../../types/tag';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

const tags: Tag[] = [
  { id: 'npc', name: 'NPC', category: 'Type', mainPosition: 0 },
  { id: 'place', name: 'Luogo', category: null, mainPosition: null },
];

function render(list: Tag[] = tags) {
  renderWithProviders(<TagManagement roomId="room-1" tags={list} />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(undefined);
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('TagManagement', () => {
  it('lists every Tag by name with its category', () => {
    render();

    expect(screen.getByText(/NPC/)).toBeInTheDocument();
    expect(screen.getByText(/Type/)).toBeInTheDocument();
    expect(screen.getByText('Luogo')).toBeInTheDocument();
  });

  it('says so when the Room has no Tags', () => {
    render([]);

    expect(screen.getByText('Questa Stanza non ha Tag.')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and cancelling deletes nothing', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
    expect(screen.getByText('Eliminare il Tag "NPC"?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    await waitFor(() =>
      expect(screen.queryByText('Eliminare il Tag "NPC"?')).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes the confirmation with Escape without deleting', async () => {
    const { user } = render();
    await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByText('Eliminare il Tag "NPC"?')).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes the confirmed Tag and reports it', async () => {
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/npc', {
        method: 'DELETE',
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag "NPC" eliminato'));
  });

  it('reports a failed deletion and keeps the confirmation open', async () => {
    const error = new Error('nope');
    fetchMock.mockRejectedValue(error);
    const { user } = render();

    await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
    await user.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);
    expect(screen.getByText('Eliminare il Tag "NPC"?')).toBeInTheDocument();
  });
});
