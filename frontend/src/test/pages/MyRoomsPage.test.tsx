import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawMyRoom } from '../fixtures';
import { renderWithProviders } from '../utils';
import { MyRoomsPage } from '../../pages/MyRoomsPage';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const sessionMock = vi.mocked(useSession);
type SessionState = ReturnType<typeof useSession>;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue([rawMyRoom()]);
});

describe('MyRoomsPage', () => {
  it('shows the header and the Rooms once signed in', async () => {
    sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
    renderWithProviders(<MyRoomsPage />, { route: '/rooms' });

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(await screen.findByText('La Cripta')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the sign-in block', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);
    renderWithProviders(<MyRoomsPage />, { route: '/rooms' });

    expect(screen.getByRole('link', { name: 'Vai al login' })).toHaveAttribute('href', '/#sign-in');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
