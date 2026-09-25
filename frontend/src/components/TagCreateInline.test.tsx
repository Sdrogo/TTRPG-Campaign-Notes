import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { renderWithProviders } from '../test/utils';
import { TagCreateInline } from './TagCreateInline';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function render() {
  const onCreated = vi.fn();
  const onPendingChange = vi.fn();
  renderWithProviders(
    <TagCreateInline roomId="room-1" onCreated={onCreated} onPendingChange={onPendingChange} />,
  );
  return { onCreated, onPendingChange, user: userEvent.setup() };
}

const field = () => screen.getByRole('textbox', { name: 'Nuovo tag' });
const addButton = () => screen.getByRole('button', { name: /Aggiungi/ });

beforeEach(() => {
  fetchMock.mockReset();
});

describe('TagCreateInline', () => {
  it('cannot add a blank Tag', () => {
    render();

    expect(addButton()).toBeDisabled();
  });

  it('creates the Tag and reports it', async () => {
    fetchMock.mockResolvedValue({ id: 'tag-9', name: 'Fazione', category: null });
    const { onCreated, user } = render();

    await user.type(field(), 'Fazione');
    await user.click(addButton());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
        method: 'POST',
        json: { name: 'Fazione', category: null },
      }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: 'tag-9', name: 'Fazione', category: null }),
    );
  });

  it('clears the field once created', async () => {
    fetchMock.mockResolvedValue({ id: 'tag-9', name: 'Fazione', category: null });
    const { user } = render();

    await user.type(field(), 'Fazione');
    await user.click(addButton());

    await waitFor(() => expect(field()).toHaveValue(''));
  });

  it('reports pending while the creation is in flight, then settles', async () => {
    let resolve: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { onPendingChange, user } = render();

    await user.type(field(), 'Fazione');
    await user.click(addButton());

    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(true));

    resolve({ id: 'tag-9', name: 'Fazione', category: null });

    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  });

  it('treats a whitespace-only name as blank', async () => {
    const { user } = render();

    await user.type(field(), '   ');

    expect(addButton()).toBeDisabled();
  });
});
