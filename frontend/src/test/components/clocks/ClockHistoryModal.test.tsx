import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { toClock, toRules } from '../../../lib/clocks';
import { rawClock, rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockHistoryModal } from '../../../components/clocks/ClockHistoryModal';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const members = [{ userId: 'user-1', displayName: 'Marco', role: 'player', isAdmin: false } as Member];
const entry = (id: string, action: string, details = {}) => ({
  id,
  user_id: 'user-1',
  action,
  details,
  created_at: new Date().toISOString(),
});

function render() {
  renderWithProviders(
    <ClockHistoryModal
      roomId="room-1"
      clock={toClock(rawClock())}
      kinds={toRules(rawRules()).markKinds}
      members={members}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('ClockHistoryModal', () => {
  it('lists the lines newest first and loads more', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({ entries: [entry('a', 'marked', { delta: 1, filled: 5, segments: 8 })], next_before: 'x' })
      .mockResolvedValueOnce({ entries: [entry('b', 'created')], next_before: null });
    render();
    expect(await screen.findByText(/Marco · \+1 · 5\/8/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostra altri' }));
    expect(await screen.findByText(/ha aperto il clock/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mostra altri' })).not.toBeInTheDocument());
  });

  it('says when the history cannot load', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    render();
    expect(await screen.findByText('Impossibile caricare la cronologia.')).toBeInTheDocument();
  });
});
