import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { toRules } from '../../../lib/clocks';
import { rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockRulesDialog } from '../../../components/clocks/ClockRulesDialog';
import type { RawRules } from '../../../lib/clocks';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('@mantine/notifications', async (original) => {
  const actual = await original<typeof import('@mantine/notifications')>();
  return { ...actual, notifications: { ...actual.notifications, show: vi.fn() } };
});

const fetchMock = vi.mocked(apiFetch);

function render(overrides: Partial<RawRules> = {}) {
  const user = userEvent.setup();
  renderWithProviders(<ClockRulesDialog roomId="room-1" rules={toRules(rawRules(overrides))} onClose={vi.fn()} />);
  return { user };
}

const saveRules = () => screen.getByRole('button', { name: 'Salva le regole' });
const lastCall = () => fetchMock.mock.calls.at(-1);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifications.show).mockReset();
});

describe('ClockRulesDialog', { timeout: 20_000 }, () => {
  it('fills the policies from a preset and saves them', async () => {
    fetchMock.mockResolvedValue(rawRules({ open_policy: 'everyone', mark_policy: 'everyone' }));
    const { user } = render();
    expect(screen.getByRole('radio', { name: /Semplice/ })).toHaveAttribute('aria-checked', 'true');
    expect(saveRules()).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Tutto il tavolo/ }));
    expect(screen.getByRole('combobox', { name: 'Chi apre un clock' })).toHaveValue('Tutti');
    await user.click(saveRules());
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-rules', {
      method: 'PUT',
      json: { open_policy: 'everyone', mark_policy: 'everyone', allow_unmark: true },
    });
  });

  it('sets each policy by hand and shows a failed save', async () => {
    fetchMock.mockRejectedValue(new ApiError(403, 'Non sei il Master'));
    const { user } = render();
    await user.click(screen.getByRole('combobox', { name: 'Chi apre un clock' }));
    await user.click(screen.getByRole('option', { name: 'I giocatori propongono, il Master approva' }));
    await user.click(screen.getByRole('combobox', { name: 'Chi segna' }));
    await user.click(screen.getByRole('option', { name: "Il Master e chi l'ha aperto" }));
    await user.click(screen.getByRole('radio', { name: /Non si torna indietro/ }));
    expect(screen.queryByRole('radio', { checked: true, name: /Semplice|Tutto|Senza/ })).not.toBeInTheDocument();
    await user.click(saveRules());
    expect(await screen.findByText('Non sei il Master')).toBeInTheDocument();
    expect(lastCall()?.[1]).toMatchObject({
      json: { open_policy: 'propose', mark_policy: 'master_and_creator', allow_unmark: false },
    });
    await user.click(screen.getByRole('radio', { name: 'Si può svuotare' }));
  });

  it('adds a label, then cancels another', async () => {
    fetchMock.mockResolvedValue({ id: 'l2', name: 'Rock', color: 'red', position: 1, clock_count: 0 });
    const { user } = render();
    await user.click(screen.getByRole('button', { name: 'Nuova etichetta' }));
    const names = screen.getAllByRole('textbox', { name: 'Nome' });
    await user.type(names[names.length - 3], 'Rock');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aggiungi' })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/clock-rules/labels', {
      method: 'POST',
      json: { name: 'Rock', color: 'default' },
    });
    await user.click(screen.getByRole('button', { name: 'Nuova etichetta' }));
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'Nuova etichetta' })).toBeInTheDocument();
  });

  it('adds a mark kind, and shows a failure', async () => {
    fetchMock.mockRejectedValue(new ApiError(400, 'Troppi tipi'));
    const { user } = render();
    await user.click(screen.getByRole('button', { name: 'Nuovo tipo di segno' }));
    const names = screen.getAllByRole('textbox', { name: 'Nome' });
    await user.type(names[names.length - 1], 'Rischio');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Troppi tipi' })));
    expect(lastCall()).toEqual([
      '/rooms/room-1/clock-rules/mark-kinds',
      { method: 'POST', json: { name: 'Rischio', color: 'default', who: 'everyone' } },
    ]);
  });

  it("saves a kind's new name, colour and who, only once changed", async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(400, 'No')).mockResolvedValue({});
    const { user } = render();
    expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();
    const shock = screen.getByDisplayValue('Shock');
    await user.clear(shock);
    await user.type(shock, 'Paura');
    const colors = screen.getAllByRole('combobox', { name: 'Colore' });
    await user.click(colors[2]);
    await user.click(screen.getByRole('option', { name: 'Viola' }));
    const who = screen.getAllByRole('combobox', { name: 'Chi può usarlo' });
    await user.click(who[1]);
    await user.click(screen.getByRole('option', { name: 'Tutti' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    expect(lastCall()).toEqual([
      '/rooms/room-1/clock-rules/mark-kinds/kind-2',
      { method: 'PATCH', json: { name: 'Paura', color: 'violet', who: 'everyone' } },
    ]);
  });

  it('renames a label', async () => {
    fetchMock.mockResolvedValue({});
    const { user } = render();
    const jazz = screen.getByDisplayValue('Jazz');
    await user.type(jazz, '!');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() =>
      expect(lastCall()).toEqual([
        '/rooms/room-1/clock-rules/labels/label-1',
        { method: 'PATCH', json: { name: 'Jazz!', color: 'violet' } },
      ]),
    );
  });

  it('confirms deleting a label in use', async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(500, 'Errore')).mockResolvedValue(undefined);
    const { user } = render();
    await user.click(screen.getByRole('button', { name: 'Elimina «Jazz»' }));
    const dialog = await screen.findByRole('dialog', { name: "Eliminare l'etichetta?" });
    expect(dialog).toHaveTextContent('«Jazz» verrà tolta da 2 clock.');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Eliminare l'etichetta?" })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Elimina «Jazz»' }));
    await screen.findByRole('dialog', { name: "Eliminare l'etichetta?" });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Eliminare l'etichetta?" })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Elimina «Jazz»' }));
    const again = await screen.findByRole('dialog', { name: "Eliminare l'etichetta?" });
    await user.click(within(again).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    await user.click(within(again).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Eliminare l'etichetta?" })).not.toBeInTheDocument());
    expect(lastCall()).toEqual(['/rooms/room-1/clock-rules/labels/label-1', { method: 'DELETE' }]);
  });

  it('deletes an unused label, a kind and a template at once', async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(500, 'Errore')).mockResolvedValue(undefined);
    const { user } = render({
      labels: [
        { id: 'l', name: 'Rock', color: 'red', position: 0, clock_count: 0 },
        { id: 'p', name: 'Pop', color: 'red', position: 1 },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Elimina «Rock»' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Elimina «Pop»' }));
    await user.click(screen.getByRole('button', { name: 'Elimina «Successo»' }));
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Elimina il modello «Bomba»' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Elimina il modello «Bomba»' })).toHaveAttribute('data-loading', 'true'),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        '/rooms/room-1/clock-rules/labels/l',
        '/rooms/room-1/clock-rules/labels/p',
        '/rooms/room-1/clock-rules/mark-kinds/kind-1',
        '/rooms/room-1/clock-rules/templates/template-1',
      ]),
    );
  });

  it('says when there are no templates, and stops at six kinds', () => {
    const kind = (i: number) => ({ id: `k${i}`, name: `K${i}`, color: 'red' as const, who: 'everyone' as const, position: i });
    render({ templates: [], mark_kinds: [0, 1, 2, 3, 4, 5].map(kind) });
    expect(screen.getByText('Nessun modello: salvane uno dal dialogo di un clock.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuovo tipo di segno' })).toBeDisabled();
  });
});
