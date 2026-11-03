import type { ReactNode } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { REVEAL_BLOCK_EVENT } from '../../../lib/landing';
import { ViewAsContext } from '../../../hooks/useViewAs';
import { rawClock, rawGroup, rawRules } from '../../clockFixtures';
import { rawMember } from '../../fixtures';
import { block } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';
import { ClockBlock } from '../../../components/clocks/ClockBlock';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../../hooks/useRoomEvents', () => ({ useRoomEvents: vi.fn(() => 'open') }));

const fetchMock = vi.mocked(apiFetch);
let clocks: unknown[];

function render({
  overrides = {},
  isMaster = true,
  bar = undefined as ReactNode,
  previewing = false,
}: { overrides?: Record<string, unknown>; isMaster?: boolean; bar?: ReactNode; previewing?: boolean } = {}) {
  renderWithProviders(
    <ClockBlock
      roomId="room-1"
      block={block({ kind: 'clocks', clock_chips: [{ clock_id: null, group_id: 'group-1' }], ...overrides })}
      heading="Clock"
      isMaster={isMaster}
      currentUserId="user-1"
      bar={bar}
    />,
    {
      wrapper: previewing
        ? ({ children }) => (
            <ViewAsContext.Provider value={{ roomId: 'room-1', userId: 'user-2' }}>{children}</ViewAsContext.Provider>
          )
        : undefined,
    },
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  fetchMock.mockReset();
  clocks = [rawClock()];
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && path.endsWith('/marks')) return { clock: rawClock({ filled: 5 }), mark_id: 'm' };
    if (path === '/rooms/room-1/clocks') return clocks;
    if (path === '/rooms/room-1/clock-rules') return rawRules();
    if (path === '/rooms/room-1/clock-groups') return [rawGroup()];
    if (path === '/rooms/room-1/members') return [rawMember()];
    if (path.includes('/history')) return { entries: [], next_before: null };
    return [];
  });
});

describe('ClockBlock', { timeout: 20_000 }, () => {
  it("shows its group's clocks, marked in place, with the legend, and folds", async () => {
    const { user } = render();
    expect(screen.getByRole('region', { name: 'Clock' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Allarme: 4 su 8, Aperto' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tipi di segno' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Segna un segmento di «Allarme»' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks', expect.objectContaining({ method: 'POST' })),
    );
    const toggle = screen.getByRole('button', { name: /^Clock/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens "Segna…" and the history from a card', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Azioni di «Allarme»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Segna…' }));
    const mark = await screen.findByRole('dialog', { name: 'Segna «Allarme»' });
    await user.click(within(mark).getByRole('button', { name: 'Segna 1' }));
    await waitFor(() => expect(mark).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cronologia' }));
    await screen.findByRole('dialog', { name: 'Cronologia di «Allarme»' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cronologia di «Allarme»' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Azioni di «Allarme»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Segna…' }));
    await user.click(await screen.findByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Segna «Allarme»' })).not.toBeInTheDocument());
  });

  it('tells the Master it has nothing to show, and leaves it out for a Player', async () => {
    clocks = [];
    render();
    expect(await screen.findByText('Niente da mostrare')).toBeInTheDocument();
  });

  it('is left out for a Player who sees none of its clocks', async () => {
    clocks = [];
    render({ isMaster: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clocks'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Clock' })).not.toBeInTheDocument());
  });

  it('starts folded when the Master set it, opens for the Index, and shows the bar in edit mode', async () => {
    const { user } = render({ overrides: { collapsed: true, all_clocks: true }, bar: <span>bar</span> });
    expect(screen.getByText('bar')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Espandi Clock' });
    act(() => {
      window.dispatchEvent(new CustomEvent(REVEAL_BLOCK_EVENT, { detail: 'other' }));
      window.dispatchEvent(new CustomEvent(REVEAL_BLOCK_EVENT, { detail: 'block-1' }));
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Comprimi Clock' }));
  });

  it('marks nothing under View as', async () => {
    const { user } = render({ previewing: true });
    await user.click(await screen.findByRole('button', { name: 'Segna un segmento di «Allarme»' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/rooms/room-1/clocks/clock-1/marks', expect.anything());
  });
});
