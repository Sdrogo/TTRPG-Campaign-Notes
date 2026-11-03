import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { toClock } from '../../lib/clocks';
import { theme } from '../../theme/theme';
import { rawClock } from '../clockFixtures';
import { renderHookWithProviders } from '../utils';
import { useClockMarker } from '../../hooks/useClockMarker';

vi.mock('../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('@mantine/notifications', async (original) => {
  const actual = await original<typeof import('@mantine/notifications')>();
  return {
    ...actual,
    notifications: { ...actual.notifications, show: vi.fn(), hide: vi.fn() },
  };
});

const fetchMock = vi.mocked(apiFetch);
const show = vi.mocked(notifications.show);
const clock = toClock(rawClock());

/** Renders the toast's message, so its "Annulla" can be pressed. */
function renderToast(call = 0) {
  render(<MantineProvider theme={theme}>{show.mock.calls[call][0].message as ReactNode}</MantineProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  show.mockReset();
  vi.mocked(notifications.hide).mockReset();
});

describe('useClockMarker', () => {
  it('toasts the mark the server applied, and takes it back on "Annulla"', async () => {
    fetchMock.mockResolvedValueOnce({ clock: rawClock({ filled: 6 }), mark_id: 'mark-1' });
    const { result } = renderHookWithProviders(() => useClockMarker('room-1'));
    act(() => result.current.mark(clock, { delta: 3 }));
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(show.mock.calls[0][0]).toMatchObject({ id: 'clock-mark-mark-1', autoClose: 5000 });
    renderToast();
    expect(screen.getByText('+2 su «Allarme»')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ clock: rawClock({ filled: 4 }), mark_id: 'mark-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(notifications.hide).toHaveBeenCalledWith('clock-mark-mark-1');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/clocks/clock-1/marks/mark-1/undo', { method: 'POST' }),
    );
  });

  it('says an emptied wedge as a negative delta', async () => {
    fetchMock.mockResolvedValueOnce({ clock: rawClock({ filled: 3 }), mark_id: 'mark-2' });
    const { result } = renderHookWithProviders(() => useClockMarker('room-1'));
    act(() => result.current.mark(clock, { delta: -1 }));
    await waitFor(() => expect(show).toHaveBeenCalled());
    renderToast();
    expect(screen.getByText('-1 su «Allarme»')).toBeInTheDocument();
  });

  it('stays quiet when the server clamped the mark to nothing', async () => {
    fetchMock.mockResolvedValueOnce({ clock: rawClock(), mark_id: 'mark-3' });
    const { result } = renderHookWithProviders(() => useClockMarker('room-1'));
    act(() => result.current.mark(clock, { delta: 1 }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(show).not.toHaveBeenCalled();
  });

  it('shows a failed mark or undo as an error', async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(403, 'Non puoi segnare'));
    const { result } = renderHookWithProviders(() => useClockMarker('room-1'));
    act(() => result.current.mark(clock, { delta: 1 }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ color: 'red' })));

    fetchMock.mockResolvedValueOnce({ clock: rawClock({ filled: 5 }), mark_id: 'mark-4' });
    act(() => result.current.mark(clock, { delta: 1 }));
    await waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    renderToast(1);
    fetchMock.mockRejectedValueOnce(new ApiError(409, 'Troppo tardi'));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(show).toHaveBeenCalledTimes(3));
    expect(show.mock.calls[2][0]).toMatchObject({ color: 'red', message: 'Troppo tardi' });
  });
});
