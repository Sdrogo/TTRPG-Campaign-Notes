import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { rawClock, rawGroup, rawRules } from '../../clockFixtures';
import { rawMember, rawRoom } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { ClockChipsEditor, MAX_CLOCK_CHIPS } from '../../../components/clocks/ClockChipsEditor';
import type { BlockInput, ClockChip } from '../../../types/landing';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../../components/landing/Sortable', () => import('../landing/sortableMock'));

const fetchMock = vi.mocked(apiFetch);
let documents: Promise<unknown>;
let create: () => Promise<unknown>;
let room: Promise<unknown>;

function block(overrides: Partial<BlockInput> = {}): BlockInput {
  return {
    kind: 'clocks',
    heading: null,
    tagIds: [],
    groups: [],
    mapKind: null,
    features: [],
    collapsed: false,
    moduleId: null,
    clockChips: [],
    allClocks: false,
    ...overrides,
  };
}

function render(input = block(), initialOpen = false) {
  const onChange = vi.fn();
  const onCancelDraft = vi.fn();
  renderWithProviders(
    <ClockChipsEditor
      roomId="room-1"
      currentUserId="user-1"
      block={input}
      initialOpen={initialOpen}
      onChange={onChange}
      onCancelDraft={onCancelDraft}
    />,
  );
  return { user: userEvent.setup(), onChange, onCancelDraft };
}

beforeEach(() => {
  fetchMock.mockReset();
  create = () => Promise.resolve(rawClock({ id: 'clock-9', name: 'Nuovo' }));
  room = Promise.resolve(rawRoom({ default_visibility: 'master' }));
  documents = Promise.resolve([]);
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && path === '/rooms/room-1/clocks') return create();
    if (path === '/rooms/room-1/clocks')
      return [rawClock(), rawClock({ id: 'clock-2', name: 'Fuga' }), rawClock({ id: 'clock-3', name: 'Vecchio', archived: true })];
    if (path === '/rooms/room-1/clock-groups') return [rawGroup()];
    if (path === '/rooms/room-1/clock-rules') return rawRules();
    if (path === '/rooms/room-1/members') return [rawMember({ role: 'master' })];
    if (path.startsWith('/rooms/room-1/documents')) return documents;
    if (path === '/rooms/room-1') return room;
    return [];
  });
});

describe('ClockChipsEditor', { timeout: 20_000 }, () => {
  it('opens at once for a new block, adds a group, and drops the draft when closed empty', async () => {
    const { user, onChange, onCancelDraft } = render(block(), true);
    const picker = await screen.findByRole('dialog', { name: 'Clock' });
    expect(await within(picker).findByRole('button', { name: 'Gruppo «Fuga»' })).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: 'Vecchio' })).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: 'Gruppo «Fuga»' }));
    expect(onChange).toHaveBeenCalledWith(block({ clockChips: [{ clockId: null, groupId: 'group-1' }] }));
    await user.click(screen.getByRole('button', { name: 'Clock' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onCancelDraft).toHaveBeenCalled());
  });

  it('shows its chips, removes and reorders them, and offers only the others', async () => {
    const chips: ClockChip[] = [
      { clockId: 'clock-1', groupId: null },
      { clockId: null, groupId: 'group-1' },
      { clockId: 'gone', groupId: null },
      { clockId: null, groupId: 'gone' },
    ];
    const { user, onChange } = render(block({ clockChips: chips }));
    expect(await screen.findByText('Allarme')).toBeInTheDocument();
    expect(await screen.findByText('Gruppo «Fuga»')).toBeInTheDocument();
    expect(screen.getByText('Non più disponibile')).toBeInTheDocument();
    expect(screen.getByText('Gruppo «Non più disponibile»')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Togli Allarme' }));
    expect(onChange).toHaveBeenLastCalledWith(block({ clockChips: chips.slice(1) }));
    await user.click(screen.getByRole('button', { name: /^Riordina/ }));
    expect(onChange).toHaveBeenLastCalledWith(block({ clockChips: [...chips].reverse() }));
    await user.click(screen.getByRole('button', { name: 'Clock' }));
    const picker = await screen.findByRole('dialog', { name: 'Clock' });
    expect(within(picker).queryByRole('button', { name: 'Allarme' })).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: 'Fuga' }));
    expect(onChange).toHaveBeenLastCalledWith(block({ clockChips: [...chips, { clockId: 'clock-2', groupId: null }] }));
  });

  it('says when nothing is left to add, and stops at the limit', async () => {
    const all: ClockChip[] = [
      { clockId: 'clock-1', groupId: null },
      { clockId: 'clock-2', groupId: null },
      { clockId: null, groupId: 'group-1' },
    ];
    const { user } = render(block({ clockChips: all }));
    await screen.findByText('Gruppo «Fuga»');
    await user.click(screen.getByRole('button', { name: 'Clock' }));
    expect(await screen.findByText('Nessun altro clock o gruppo.')).toBeInTheDocument();
  });

  it('is full at 20 chips', async () => {
    const many = Array.from({ length: MAX_CLOCK_CHIPS }, (_, n) => ({ clockId: `c${n}`, groupId: null }));
    render(block({ clockChips: many }));
    expect(screen.getByRole('button', { name: 'Clock' })).toBeDisabled();
  });

  it('follows every open clock with the switch, hiding the chips', async () => {
    const { user, onChange } = render(block({ allClocks: true, clockChips: [{ clockId: 'clock-1', groupId: null }] }));
    expect(screen.queryByRole('button', { name: 'Clock' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Tutti i clock aperti' }));
    expect(onChange).toHaveBeenCalledWith(block({ allClocks: false, clockChips: [{ clockId: 'clock-1', groupId: null }] }));
  });

  it('creates a clock from the picker and adds it, in the Room default visibility', async () => {
    const { user, onChange } = render();
    await user.click(screen.getByRole('button', { name: 'Clock' }));
    await user.click(await screen.findByRole('button', { name: 'Nuovo clock…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo clock' });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master (e te)'));
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Nuovo');
    await user.click(within(dialog).getByRole('button', { name: 'Crea il clock' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(block({ clockChips: [{ clockId: 'clock-9', groupId: null }] })));
    expect(screen.queryByRole('dialog', { name: 'Nuovo clock' })).not.toBeInTheDocument();
  });

  it('shows a failed create, and drops a draft when the dialog is cancelled', async () => {
    create = () => Promise.reject(new ApiError(400, 'Troppi clock'));
    room = new Promise(() => {});
    documents = new Promise(() => {});
    const { user, onCancelDraft } = render();
    await user.click(screen.getByRole('button', { name: 'Clock' }));
    await user.click(await screen.findByRole('button', { name: 'Nuovo clock…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo clock' });
    expect(within(dialog).getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Stanza (tutti i membri)');
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Nuovo');
    await user.click(within(dialog).getByRole('button', { name: 'Crea il clock' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Troppi clock');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(onCancelDraft).toHaveBeenCalled());
  });
});
