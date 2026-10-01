import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { renderWithProviders } from '../../utils';
import { DeleteRoomSection } from '../../../components/setup/DeleteRoomSection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function render() {
  const onDeleted = vi.fn();
  renderWithProviders(
    <DeleteRoomSection roomId="room-1" roomName="La Cripta" onDeleted={onDeleted} />,
  );
  return { onDeleted, user: userEvent.setup() };
}

/** Opens the confirmation and returns the red confirm button. */
async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Elimina Stanza' }));
  return screen.getByRole('button', { name: 'Elimina' });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(undefined);
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('DeleteRoomSection', () => {
  // Spec 13: the most destructive action asks for the Room's name.
  it('keeps the confirm button disabled until the Room name is typed', async () => {
    const { user } = render();
    const confirm = await openConfirmation(user);
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'La Cript');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'a');
    expect(confirm).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes the Room, reports it and hands over to the caller', async () => {
    const { onDeleted, user } = render();
    const confirm = await openConfirmation(user);
    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'La Cripta');

    await user.click(confirm);

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1', {
      method: 'DELETE',
    });
    expect(notifySuccess).toHaveBeenCalledWith('Stanza "La Cripta" eliminata');
  });

  it('reports a failure and does not leave the page', async () => {
    const error = new Error('nope');
    fetchMock.mockRejectedValue(error);
    const { onDeleted, user } = render();
    const confirm = await openConfirmation(user);
    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'La Cripta');

    await user.click(confirm);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(vi.mocked(notifyError).mock.calls[0][0]).toBe(error);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('cancelling closes the confirmation and forgets what was typed', async () => {
    const { user } = render();
    await openConfirmation(user);
    await user.type(screen.getByLabelText('Scrivi "La Cripta" per confermare'), 'La Cripta');

    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Scrivi "La Cripta" per confermare')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Elimina Stanza' }));

    expect(screen.getByLabelText('Scrivi "La Cripta" per confermare')).toHaveValue('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
