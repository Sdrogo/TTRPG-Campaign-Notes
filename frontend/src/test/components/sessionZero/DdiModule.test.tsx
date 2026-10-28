import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DdiBoard } from '../../../components/sessionZero/DdiModule';
import { ApiError, apiFetch } from '../../../lib/apiClient';
import { boardWrites } from '../../../lib/sessionZero';
import { rawDocument, rawNote } from '../../fixtures';
import { members, renderBoard } from './harness';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function acceptance(overrides: Record<string, unknown> = {}) {
  return { user_id: 'user-2', accepted_at: '2026-10-28T09:00:00Z', outdated: false, mine: false, ...overrides };
}

/** A session whose current step is a DDI, with `overrides` on its content. */
function ddiBoard(overrides: Record<string, unknown> = {}, board: Record<string, unknown> = {}) {
  return {
    modules: [
      {
        id: 'm-ddi',
        kind: 'ddi',
        position: 0,
        columns: [],
        ddi: {
          document_id: 'doc-ddi',
          document_hidden: false,
          changed_at: '2026-10-28T08:00:00Z',
          acceptances: [],
          can_accept: false,
          ...overrides,
        },
      },
    ],
    current_module_id: 'm-ddi',
    ...board,
  };
}

const closed = [{ id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' }];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path === '/rooms/room-1/documents/doc-ddi') {
      return Promise.resolve(
        rawDocument({
          id: 'doc-ddi',
          name: "Dichiarazione d'Intenti",
          description: '## Dietro il Tavolo',
          notes: [rawNote({ title: 'Orari', description: 'Il venerdì.' })],
        }),
      );
    }
    if (path === '/rooms/room-1/documents') {
      return Promise.resolve([rawDocument({ id: 'doc-ddi', name: 'DDI' }), rawDocument({ id: 'doc-2', name: 'Altra' })]);
    }
    return Promise.reject(new ApiError(404, 'Not found'));
  });
});

describe('DdiBoard', () => {
  it('shows nothing on a step that is not a DDI', () => {
    renderBoard(<DdiBoard roomId="room-1" />);
    expect(screen.queryByRole('region', { name: 'DDI' })).not.toBeInTheDocument();
  });
});

describe('DdiBoard for the Master', () => {
  const master = (overrides: Record<string, unknown> = {}, board: Record<string, unknown> = {}) =>
    ddiBoard(overrides, { can_manage: true, ...board });

  // Spec 47 Decision 8: the Master picks the Document, or makes it from the template.
  it('picks the Document or makes it from the template', async () => {
    const { act, user } = renderBoard(<DdiBoard roomId="room-1" />, { board: master({ document_id: null }) });
    expect(screen.getByText('Scegli il Documento della DDI o crealo dal modello.')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Documento della DDI' }));
    await user.click(await screen.findByRole('option', { name: 'Altra' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.setDdiDocument('m-ddi', 'doc-2'));
    await user.click(screen.getByRole('button', { name: 'Crea dal modello' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.createDdiFromTemplate('m-ddi'), expect.any(Function));
  });

  it('shows the Document and who accepted it', async () => {
    const roomMembers = [
      ...members,
      { ...members[0], userId: 'user-3', displayName: 'Carlo' },
      { ...members[0], userId: 'user-4', displayName: 'Dora' },
    ];
    renderBoard(<DdiBoard roomId="room-1" />, {
      board: master({ acceptances: [acceptance(), acceptance({ user_id: 'user-3', outdated: true })] }),
      roomMembers,
    });
    expect(await screen.findByRole('heading', { name: "Dichiarazione d'Intenti" })).toBeInTheDocument();
    expect(screen.getByText('## Dietro il Tavolo')).toBeInTheDocument();
    expect(screen.getByText('Orari')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri il Documento' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-ddi');
    expect(screen.getByTitle('Ha accettato')).toHaveTextContent('Bianca');
    expect(screen.getByTitle('Da riaccettare')).toHaveTextContent('Carlo · Da riaccettare');
    expect(screen.getByTitle('Non ancora')).toHaveTextContent('Dora');
  });

  it('says when there are no Players, and only shows a closed session\'s DDI', async () => {
    renderBoard(<DdiBoard roomId="room-1" />, { board: master({}, { rounds: closed }), roomMembers: [] });
    expect(screen.getByText('Nessun Player nella Stanza.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crea dal modello' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: "Dichiarazione d'Intenti" })).toBeInTheDocument();
  });

  it('says when the Document can\'t be read', async () => {
    renderBoard(<DdiBoard roomId="room-1" />, { board: master({ document_id: 'gone' }) });
    expect(await screen.findByText('Non riesco a leggere la DDI.')).toBeInTheDocument();
  });
});

describe('DdiBoard for a Player', () => {
  it('says when there is no DDI yet, or one they don\'t see', () => {
    renderBoard(<DdiBoard roomId="room-1" />, { board: ddiBoard({ document_id: null }) });
    expect(screen.getByText('Il Master non ha ancora scelto la DDI.')).toBeInTheDocument();
    document.body.innerHTML = '';
    renderBoard(<DdiBoard roomId="room-1" />, { board: ddiBoard({ document_id: null, document_hidden: true }) });
    expect(screen.getByText('Il Master non ti ha ancora reso visibile la DDI.')).toBeInTheDocument();
  });

  // Decision 8: "I have read and accept" at the end, taken back, or given again after a change.
  it('accepts the DDI', async () => {
    const { act, user } = renderBoard(<DdiBoard roomId="room-1" />, { board: ddiBoard({ can_accept: true }) });
    expect(await screen.findByRole('heading', { name: "Dichiarazione d'Intenti" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ho letto e accetto' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.acceptDdi('m-ddi', true));
  });

  it('withdraws an acceptance', async () => {
    const { act, user } = renderBoard(<DdiBoard roomId="room-1" />, {
      board: ddiBoard({ acceptances: [acceptance({ user_id: 'user-1', mine: true })] }),
    });
    expect(screen.getByText('Hai accettato la DDI.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ritira' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.acceptDdi('m-ddi', false));
  });

  it('asks again once the DDI changed', () => {
    renderBoard(<DdiBoard roomId="room-1" />, {
      board: ddiBoard({ can_accept: true, acceptances: [acceptance({ user_id: 'user-1', mine: true, outdated: true })] }),
    });
    expect(screen.getByText("La DDI è cambiata dopo che l'hai accettata.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ho letto e accetto' })).toBeInTheDocument();
  });

  it('only reads a closed session\'s DDI, and has nothing to do without an acceptance', () => {
    renderBoard(<DdiBoard roomId="room-1" />, { board: ddiBoard({ can_accept: true }, { rounds: closed }) });
    expect(screen.queryByRole('button', { name: 'Ho letto e accetto' })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    renderBoard(<DdiBoard roomId="room-1" />, { board: ddiBoard() });
    expect(screen.queryByRole('button', { name: 'Ritira' })).not.toBeInTheDocument();
  });
});
