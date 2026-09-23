import { notifications } from '@mantine/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiClient';
import { notifyError, notifySuccess } from './notify';

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const show = vi.mocked(notifications.show);

beforeEach(() => {
  show.mockClear();
});

describe('notifyError', () => {
  it("shows an Error's message in red", () => {
    notifyError(new Error('Qualcosa è andato storto'));

    expect(show).toHaveBeenCalledWith({ color: 'red', message: 'Qualcosa è andato storto' });
  });

  // Every failed request arrives here as an ApiError; the backend's `detail`
  // is already its message, so the user sees the real reason.
  it("surfaces an ApiError's detail message", () => {
    notifyError(new ApiError(403, 'Not a member of this room'));

    expect(show).toHaveBeenCalledWith({ color: 'red', message: 'Not a member of this room' });
  });

  it('stringifies a non-Error rejection', () => {
    notifyError('plain string');

    expect(show).toHaveBeenCalledWith({ color: 'red', message: 'plain string' });
  });
});

describe('notifySuccess', () => {
  it('uses the success theme token, not a hardcoded colour', () => {
    notifySuccess('Salvato');

    expect(show).toHaveBeenCalledWith({ color: 'var(--state-success)', message: 'Salvato' });
  });
});
