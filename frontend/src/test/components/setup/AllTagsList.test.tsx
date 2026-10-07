import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { renderWithProviders } from '../../utils';
import { AllTagsList } from '../../../components/setup/AllTagsList';
import type { Tag } from '../../../types/tag';

vi.mock('../../../lib/apiClient', async () => ({
  ...(await vi.importActual<typeof import('../../../lib/apiClient')>('../../../lib/apiClient')),
  apiFetch: vi.fn(),
}));
vi.mock('../../../lib/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

const tags: Tag[] = [
  { id: 'npc', name: 'NPC', category: 'Type', mainPosition: 0 },
  { id: 'place', name: 'Luogo', category: null, mainPosition: null },
  { id: 'city', name: 'Città', category: null, mainPosition: null },
];

function render(list: Tag[] = tags, grouped: string[] = ['npc']) {
  renderWithProviders(<AllTagsList roomId="room-1" tags={list} groupedIds={new Set(grouped)} />);
  return { user: userEvent.setup() };
}

/** The Tag names on screen, in order. */
const names = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('p')?.textContent);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(undefined);
  vi.mocked(notifyError).mockClear();
  vi.mocked(notifySuccess).mockClear();
});

describe('AllTagsList', () => {
  it('lists every Tag alphabetically, with its category and the grouping marker', () => {
    render();

    expect(names()).toEqual(['#Città', '#Luogo', '#NPC']);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Nel raggruppamento' })).toHaveLength(1);
  });

  it('says so when the Room has no Tags', () => {
    render([]);

    expect(screen.getByText('Questa Stanza non ha Tag.')).toBeInTheDocument();
  });

  // Spec 25c Decision 7: like the mention popup, accents and case don't matter.
  it('filters the Tags ignoring accents and case', async () => {
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: 'Filtra i Tag' }), 'CITTA');

    expect(names()).toEqual(['#Città']);
  });

  it('says so when the filter matches nothing', async () => {
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: 'Filtra i Tag' }), 'zzz');

    expect(screen.getByText('Nessun Tag corrisponde a "zzz".')).toBeInTheDocument();
  });

  // Spec 25c Decision 6: Tags can be created from the setup page.
  describe('creating a Tag', () => {
    it('creates the typed Tag with Enter and clears the field', async () => {
      fetchMock.mockResolvedValue({ id: 'f', name: 'Fazione', category: null });
      const { user } = render();

      const field = screen.getByRole('textbox', { name: 'Nuovo Tag' });
      await user.type(field, '  Fazione {Enter}');

      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags', {
        method: 'POST',
        json: { name: 'Fazione', category: null },
      });
      await waitFor(() => expect(field).toHaveValue(''));
      expect(notifySuccess).toHaveBeenCalledWith('Tag "Fazione" creato');
    });

    it('creates with the + button, which waits for a name', async () => {
      fetchMock.mockResolvedValue({ id: 'f', name: 'Fazione', category: null });
      const { user } = render();

      const button = screen.getByRole('button', { name: 'Crea il Tag' });
      expect(button).toBeDisabled();
      await user.type(screen.getByRole('textbox', { name: 'Nuovo Tag' }), 'Fazione');
      await user.click(button);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ignores Enter on a blank name', async () => {
      const { user } = render();

      await user.type(screen.getByRole('textbox', { name: 'Nuovo Tag' }), '   {Enter}');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows a refused name under the field until it is edited', async () => {
      fetchMock.mockRejectedValue(new ApiError(409, 'Esiste già un Tag con questo nome'));
      const { user } = render();

      const field = screen.getByRole('textbox', { name: 'Nuovo Tag' });
      await user.type(field, 'NPC{Enter}');

      expect(await screen.findByText('Esiste già un Tag con questo nome')).toBeInTheDocument();
      expect(field).toHaveValue('NPC');
      await user.type(field, 's');
      expect(screen.queryByText('Esiste già un Tag con questo nome')).not.toBeInTheDocument();
    });
  });

  it('shows a failure that is not an Error as text', async () => {
    fetchMock.mockRejectedValue('offline');
    const { user } = render();

    await user.type(screen.getByRole('textbox', { name: 'Nuovo Tag' }), 'Fazione{Enter}');

    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  // Spec 25c Decision 4: rename in place.
  describe('renaming a Tag', () => {
    it('opens a prefilled field and saves the new name with Enter', async () => {
      fetchMock.mockResolvedValue({ id: 'place', name: 'Luoghi', category: null });
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      const field = screen.getByRole('textbox', { name: 'Nuovo nome per Luogo' });
      expect(field).toHaveValue('Luogo');
      await user.clear(field);
      await user.type(field, 'Luoghi{Enter}');

      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/place', {
        method: 'PATCH',
        json: { name: 'Luoghi' },
      });
      await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag rinominato in "Luoghi"'));
      expect(screen.queryByRole('textbox', { name: 'Nuovo nome per Luogo' })).toBeNull();
    });

    it('saves with the check button', async () => {
      fetchMock.mockResolvedValue({ id: 'place', name: 'Luoghi', category: null });
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      await user.type(screen.getByRole('textbox', { name: 'Nuovo nome per Luogo' }), 'hi');
      await user.click(screen.getByRole('button', { name: 'Salva il nome' }));

      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/place', {
        method: 'PATCH',
        json: { name: 'Luogohi' },
      });
    });

    it('keeps the field open with the reason when the name is refused', async () => {
      fetchMock.mockRejectedValue(new ApiError(409, 'Esiste già un Tag con questo nome'));
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      const field = screen.getByRole('textbox', { name: 'Nuovo nome per Luogo' });
      await user.clear(field);
      await user.type(field, 'NPC{Enter}');

      expect(await screen.findByText('Esiste già un Tag con questo nome')).toBeInTheDocument();
      expect(field).toBeInTheDocument();
    });

    it('cancels with Esc, and with the X, without saving', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      await user.type(screen.getByRole('textbox', { name: 'Nuovo nome per Luogo' }), 'x{Escape}');
      expect(screen.queryByRole('textbox', { name: 'Nuovo nome per Luogo' })).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      await user.click(screen.getByRole('button', { name: 'Annulla' }));
      expect(screen.queryByRole('textbox', { name: 'Nuovo nome per Luogo' })).toBeNull();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('closes without a request when the name is unchanged, and waits on a blank one', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      const field = screen.getByRole('textbox', { name: 'Nuovo nome per Luogo' });
      await user.clear(field);
      expect(screen.getByRole('button', { name: 'Salva il nome' })).toBeDisabled();
      await user.type(field, '{Enter}');
      expect(field).toBeInTheDocument();
      await user.type(field, ' Luogo {Enter}');

      expect(screen.queryByRole('textbox', { name: 'Nuovo nome per Luogo' })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('edits one row at a time', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag Luogo' }));
      await user.click(screen.getByRole('button', { name: 'Rinomina il Tag NPC' }));

      expect(screen.queryByRole('textbox', { name: 'Nuovo nome per Luogo' })).toBeNull();
      expect(screen.getByRole('textbox', { name: 'Nuovo nome per NPC' })).toBeInTheDocument();
    });
  });

  // Spec 13: deleting still asks first.
  describe('deleting a Tag', () => {
    it('asks for confirmation, and cancelling deletes nothing', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
      expect(screen.getByText('Eliminare il Tag "NPC"?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Annulla' }));

      await waitFor(() =>
        expect(screen.queryByText('Eliminare il Tag "NPC"?')).not.toBeInTheDocument(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('closes the confirmation with Esc', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByText('Eliminare il Tag "NPC"?')).not.toBeInTheDocument(),
      );
    });

    it('deletes after confirmation and confirms it', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
      await user.click(screen.getByRole('button', { name: 'Elimina' }));

      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/tags/npc', { method: 'DELETE' });
      await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag "NPC" eliminato'));
      await waitFor(() =>
        expect(screen.queryByText('Eliminare il Tag "NPC"?')).not.toBeInTheDocument(),
      );
    });

    it('reports a failed delete and keeps the dialog', async () => {
      fetchMock.mockRejectedValue(new Error('no'));
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'Elimina il Tag NPC' }));
      await user.click(screen.getByRole('button', { name: 'Elimina' }));

      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      expect(screen.getByText('Eliminare il Tag "NPC"?')).toBeInTheDocument();
    });
  });
});
