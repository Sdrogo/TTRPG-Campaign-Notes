import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { renderWithProviders } from '../../utils';
import { GenerateMentionsModal } from '../../../components/mentions/GenerateMentionsModal';

vi.mock('../../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function match(start: number, text: string, overrides: Record<string, unknown> = {}) {
  return {
    start,
    end: start + text.length,
    text,
    kind: 'doc',
    target_id: `target-${text}`,
    target_name: text,
    before: 'prima ',
    after: ' dopo',
    ...overrides,
  };
}

const sources = [
  {
    document_id: 'doc-1',
    document_name: 'Racconto',
    note_id: null,
    note_title: null,
    matches: [match(0, 'Lyra'), match(17, 'locanda', { target_name: 'Locanda' })],
  },
  {
    document_id: 'doc-1',
    document_name: 'Racconto',
    note_id: 'note-1',
    note_title: 'Dopo',
    matches: [match(4, 'nord', { kind: 'tag', target_name: 'Nord' })],
  },
];

function render(documentId: string | null = 'doc-1', onClose = vi.fn()) {
  renderWithProviders(
    <GenerateMentionsModal roomId="room-1" documentId={documentId} onClose={onClose} />,
  );
  return onClose;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockReset();
  vi.mocked(notifySuccess).mockReset();
});

describe('GenerateMentionsModal', () => {
  it('proposes every match checked and applies only the ones left checked', async () => {
    fetchMock.mockImplementation(async (path) =>
      String(path).endsWith('/apply') ? { applied: 2, documents: 1 } : { sources },
    );
    const onClose = render();

    expect(await screen.findByText('Descrizione')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents/doc-1/mention-suggestions');
    expect(screen.getByText('Nota «Dopo»')).toBeInTheDocument();
    expect(screen.getByText('Tag: Nord')).toBeInTheDocument();
    expect(screen.getByText('Documento: Locanda')).toBeInTheDocument();
    expect(screen.getByText('3 menzioni scelte')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Collega «locanda» a Locanda' }));
    expect(screen.getByText('2 menzioni scelte')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Descrizione' })).toHaveAttribute(
      'data-indeterminate',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Applica' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith('/rooms/room-1/mention-suggestions/apply', {
      method: 'POST',
      json: {
        sources: [
          {
            document_id: 'doc-1',
            note_id: null,
            matches: [{ start: 0, end: 4, kind: 'doc', target_id: 'target-Lyra' }],
          },
          {
            document_id: 'doc-1',
            note_id: 'note-1',
            matches: [{ start: 4, end: 8, kind: 'tag', target_id: 'target-nord' }],
          },
        ],
      },
    });
    expect(notifySuccess).toHaveBeenCalledWith('Aggiunte 2 menzioni');
  });

  it('a text checkbox clears and selects all of its matches', async () => {
    fetchMock.mockResolvedValue({ sources });
    render();

    const description = await screen.findByRole('checkbox', { name: 'Descrizione' });
    await userEvent.click(description);
    expect(screen.getByText('1 menzione scelta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nota «Dopo»' }));
    expect(screen.getByRole('button', { name: 'Applica' })).toBeDisabled();
    await userEvent.click(description);
    expect(screen.getByText('2 menzioni scelte')).toBeInTheDocument();
  });

  it('names the Document of each text on the Room and says when there is nothing', async () => {
    fetchMock.mockResolvedValueOnce({ sources: [sources[0]] });
    render(null);

    expect(await screen.findByText('Racconto · Descrizione')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/mention-suggestions');
  });

  it('says when there is nothing to propose', async () => {
    fetchMock.mockResolvedValue({ sources: [] });
    render(null);

    expect(await screen.findByText(/Nessun nome da collegare/)).toBeInTheDocument();
    expect(screen.queryByText(/menzion[ei] scelt/)).not.toBeInTheDocument();
  });

  it('shows why the proposals could not be read', async () => {
    fetchMock.mockRejectedValue(new Error('Non puoi'));
    render();

    expect(await screen.findByText('Non puoi')).toBeInTheDocument();
  });

  it('reloads the preview when a text changed since it was made', async () => {
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/apply')) throw new ApiError(409, 'Cambiati');
      return { sources };
    });
    const onClose = render();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Collega «Lyra» a Lyra' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Applica' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/mention-suggestions')),
      ).toHaveLength(2),
    );
    expect(await screen.findByText('3 menzioni scelte')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the choice when applying fails for another reason', async () => {
    fetchMock.mockImplementation(async (path) => {
      if (String(path).endsWith('/apply')) throw new ApiError(403, 'No');
      return { sources };
    });
    render();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Collega «Lyra» a Lyra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Applica' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(screen.getByText('2 menzioni scelte')).toBeInTheDocument();
  });

  it('shows a loader while the proposals load', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render();

    expect(screen.getByLabelText('Cerco i nomi…')).toBeInTheDocument();
  });
});
