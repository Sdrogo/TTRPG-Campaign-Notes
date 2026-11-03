import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { emptySettings, toRules } from '../../../lib/clocks';
import { rawRules } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockDialog } from '../../../components/clocks/ClockDialog';
import type { ClockFormValues, ClockRules } from '../../../types/clock';
import type { Document } from '../../../types/document';
import type { Member } from '../../../types/member';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('@mantine/notifications', async (original) => {
  const actual = await original<typeof import('@mantine/notifications')>();
  return { ...actual, notifications: { ...actual.notifications, show: vi.fn() } };
});

const fetchMock = vi.mocked(apiFetch);
const rules = toRules(rawRules());
const documents = [{ id: 'doc-1', name: 'Villa' } as Document];
const members = [
  { userId: 'user-1', displayName: 'Marco', role: 'master', isAdmin: false } as Member,
  { userId: 'user-2', displayName: 'Giulia', role: 'player', isAdmin: false } as Member,
];

function values(overrides: Partial<ClockFormValues> = {}): ClockFormValues {
  return { ...emptySettings(), name: '', documentId: null, visibility: 'room', selectiveUserIds: [], ...overrides };
}

function render({
  isMaster = true,
  isCreate = true,
  initial = values(),
  roomRules = rules,
  error = null as string | null,
} = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <ClockDialog
      roomId="room-1"
      title="Nuovo clock"
      submitLabel="Crea il clock"
      initialValues={initial}
      rules={roomRules}
      isMaster={isMaster}
      isCreate={isCreate}
      documents={documents}
      members={members}
      creatorId="user-1"
      submitting={false}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  const submit = () => user.click(screen.getByRole('button', { name: 'Crea il clock' }));
  return { user, onSubmit, onClose, submit };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifications.show).mockReset();
});

// Typing through a whole form is slow under coverage.
describe('ClockDialog', { timeout: 20_000 }, () => {
  it('starts from a built-in template and sends the form', async () => {
    const { user, onSubmit, submit } = render();
    expect(screen.getByRole('button', { name: 'Crea il clock' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Conto alla rovescia/ }));
    expect(screen.getByRole('radio', { name: /Conto alla rovescia/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Tappa 6')).toHaveValue('Tappa 6');
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Rituale');
    await user.type(screen.getByRole('textbox', { name: 'Condizione di chiusura' }), 'Il demone arriva');
    await user.type(screen.getByRole('textbox', { name: 'Descrizione' }), 'Nella cripta');
    await user.type(screen.getByRole('textbox', { name: /Cosa succede quando si chiude/ }), 'Boom');
    await user.clear(screen.getByLabelText('Tappa 1'));
    await user.type(screen.getByLabelText('Tappa 1'), 'Candele');
    await submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Rituale',
      segments: 6,
      closingCondition: 'Il demone arriva',
      description: 'Nella cripta',
      consequence: 'Boom',
      stageLabels: ['Candele', 'Tappa 2', 'Tappa 3', 'Tappa 4', 'Tappa 5', 'Tappa 6'],
    });
  });

  it("hides a Master-only template's visibility from a Player, and the consequence", async () => {
    const { user, onSubmit, submit } = render({ isMaster: false });
    expect(screen.queryByRole('textbox', { name: /Cosa succede/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salva come modello' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Fazione/ }));
    await user.click(screen.getByRole('radio', { name: /Bomba/ }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Torre');
    await submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ visibility: 'room', consequence: null, labelIds: ['label-1'] });
  });

  it("gives the Master's Faction template Master-only visibility", async () => {
    const { user, onSubmit, submit } = render();
    await user.click(screen.getByRole('radio', { name: /Fazione/ }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Gilda');
    await submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ visibility: 'master', segments: 6 });
  });

  it('sets the size by shortcut or by number, colour, document, who marks and visibility', async () => {
    const { user, onSubmit, submit } = render({ isCreate: false, initial: values({ name: 'Allarme' }) });
    expect(screen.queryByRole('radiogroup', { name: undefined })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '12' }));
    expect(screen.getByRole('button', { name: '12' })).toHaveAttribute('aria-pressed', 'true');
    const size = screen.getByRole('textbox', { name: 'Calibro (segmenti)' });
    await user.clear(size);
    await user.type(size, '5');
    await user.click(screen.getByRole('radio', { name: 'Verde' }));
    await user.click(screen.getByRole('combobox', { name: 'Documento collegato' }));
    await user.click(screen.getByRole('option', { name: 'Villa' }));
    await user.click(screen.getByRole('combobox', { name: 'Chi lo segna' }));
    await user.click(screen.getByRole('option', { name: 'Tutti quelli che lo vedono' }));
    await user.click(screen.getByRole('checkbox', { name: /Solo avanti/ }));
    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(screen.getByRole('option', { name: /Selettivo/ }));
    await user.click(screen.getByRole('combobox', { name: 'Chi altro lo vede' }));
    await user.click(screen.getByRole('option', { name: /Giulia/ }));
    await submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      segments: 5,
      color: 'green',
      documentId: 'doc-1',
      markPolicy: 'everyone',
      forwardOnly: true,
      visibility: 'selective',
      selectiveUserIds: ['user-2'],
    });
  });

  it("goes back to the Room's rule for who marks", async () => {
    const { user, onSubmit, submit } = render({
      isCreate: false,
      initial: values({ name: 'Allarme', markPolicy: 'everyone' }),
    });
    await user.click(screen.getByRole('combobox', { name: 'Chi lo segna' }));
    await user.click(screen.getByRole('option', { name: 'Regola della Stanza (Solo il Master)' }));
    await submit();
    expect(onSubmit.mock.calls[0][0].markPolicy).toBeNull();
  });

  it('opens and hides the stages, and shows no "Solo avanti" under "Non si torna indietro"', async () => {
    const { user } = render({
      initial: values({ stageLabels: ['Uno'] }),
      roomRules: { ...rules, allowUnmark: false } as ClockRules,
    });
    expect(screen.queryByRole('checkbox', { name: /Solo avanti/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nascondi le tappe' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi le tappe (una per segmento)' }));
    expect(screen.getByLabelText('Tappa 1')).toHaveValue('Uno');
  });

  it('picks a Room label and creates a new one', async () => {
    fetchMock.mockResolvedValue({ id: 'label-2', name: 'Rock', color: 'default', position: 1, clock_count: 0 });
    const { user, onSubmit, submit } = render({ initial: values({ name: 'Allarme' }) });
    const labels = screen.getByRole('combobox', { name: 'Etichette' });
    await user.click(labels);
    await user.click(screen.getByRole('option', { name: 'Jazz' }));
    await user.type(labels, 'jazz');
    expect(screen.queryByRole('button', { name: /Crea «/ })).not.toBeInTheDocument();
    await user.clear(labels);
    await user.type(labels, 'Rock');
    await user.click(screen.getByRole('button', { name: 'Crea «Rock»' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Crea «/ })).not.toBeInTheDocument());
    await submit();
    expect(onSubmit.mock.calls[0][0].labelIds).toEqual(['label-1', 'label-2']);
  });

  it('shows a label that cannot be created as an error, and "none" to a Player', async () => {
    fetchMock.mockRejectedValue(new ApiError(409, 'Esiste già'));
    const { user } = render();
    await user.type(screen.getByRole('combobox', { name: 'Etichette' }), 'Pop');
    await user.click(screen.getByRole('button', { name: 'Crea «Pop»' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Esiste già' })));
  });

  it("offers a Player no new label", async () => {
    const { user } = render({ isMaster: false });
    await user.type(screen.getByRole('combobox', { name: 'Etichette' }), 'Pop');
    expect(screen.getByText('Nessuna etichetta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crea «/ })).not.toBeInTheDocument();
  });

  it('saves the settings as a Room template', async () => {
    fetchMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new ApiError(400, 'Troppi modelli'));
    const { user } = render({ initial: values({ name: 'Allarme' }) });
    await user.click(screen.getByRole('button', { name: 'Salva come modello' }));
    const name = screen.getByRole('textbox', { name: 'Nome del modello' });
    expect(name).toHaveValue('Allarme');
    await user.clear(name);
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
    await user.type(name, 'Bomba');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome del modello' })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/rooms/room-1/clock-rules/templates',
      expect.objectContaining({ json: expect.objectContaining({ name: 'Bomba' }) }),
    );
    await user.click(screen.getByRole('button', { name: 'Salva come modello' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Troppi modelli' })));
  });

  it('shows the error and closes', async () => {
    const { user, onClose } = render({ error: 'Qualcuno lo ha cambiato' });
    expect(screen.getByRole('alert')).toHaveTextContent('Qualcuno lo ha cambiato');
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalled();
  });
});
