import { screen, within } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { describe, expect, it, vi } from 'vitest';
import { BoardContext } from '../../../components/sessionZero/boardContext';
import { PollBoard } from '../../../components/sessionZero/PollModule';
import { boardWrites, shownModule, toSessionZero, viewOf, type RawSessionZero } from '../../../lib/sessionZero';
import type { Member } from '../../../types/member';
import { rawSessionZero } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { members, renderBoard } from './harness';

vi.mock('@mantine/notifications', async (original) => {
  const actual = await original<typeof import('@mantine/notifications')>();
  return { ...actual, notifications: { ...actual.notifications, show: vi.fn() } };
});

const roomMembers: Member[] = [
  ...members,
  { ...members[0], userId: 'user-3', displayName: 'Carlo' },
  { ...members[0], userId: 'user-1', role: 'master', displayName: 'Mara' },
];

function option(id: string, body: string, overrides: Record<string, unknown> = {}) {
  return { id, body, description: null, count: 0, voters: [], winner: false, ...overrides };
}

function poll(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    position: 0,
    body: 'Quale sistema?',
    hint: null,
    max_choices: 1,
    master_votes: false,
    voters_visible: 'master',
    results: 'live',
    revealed: false,
    closed: false,
    has_votes: false,
    options: [option('o-1', 'D&D'), option('o-2', 'PbtA')],
    my_option_ids: [],
    voter_count: 0,
    electorate: 2,
    not_voted: null,
    tally_visible: true,
    can_vote: true,
    ...overrides,
  };
}

/** A session whose current step is a Poll step holding `polls`. */
function pollBoard(polls: unknown[] | null, board: Record<string, unknown> = {}) {
  return {
    modules: [{ id: 'm-poll', kind: 'poll', position: 0, columns: [], polls }],
    current_module_id: 'm-poll',
    ...board,
  };
}

const closedRound = [
  { id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' },
];

function renderPolls(polls: unknown[] | null, board: Record<string, unknown> = {}, writable = true) {
  return renderBoard(<PollBoard />, { board: pollBoard(polls, board), roomMembers, writable });
}

describe('PollBoard', () => {
  it('shows nothing on a step that holds no polls', () => {
    renderBoard(<PollBoard />);
    expect(screen.queryByRole('region', { name: 'Sondaggio' })).not.toBeInTheDocument();
    renderPolls(null);
    expect(screen.queryByRole('region', { name: 'Sondaggio' })).not.toBeInTheDocument();
  });

  it('says when there are no polls yet', () => {
    renderPolls([]);
    expect(screen.getByText('Il Master non ha ancora preparato i sondaggi.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica sondaggi' })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    renderPolls([], { can_manage: true });
    expect(screen.getByText(/Ancora nessun sondaggio/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifica sondaggi' })).toBeInTheDocument();
  });

  // Decision 4: one choice, a radio list, saved on each change.
  it('votes for one choice and withdraws it', async () => {
    const { act, user } = renderPolls([poll()]);
    expect(screen.getByText('Hanno votato: 0 su 2')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'PbtA' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', ['o-2']));
    expect(screen.queryByRole('button', { name: 'Ritira il voto' })).not.toBeInTheDocument();
    document.body.innerHTML = '';

    const voted = renderPolls([poll({ my_option_ids: ['o-2'], hint: 'Scegline uno' })]);
    expect(screen.getByText('Scegline uno')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'PbtA' })).toBeChecked();
    await voted.user.click(screen.getByRole('button', { name: 'Ritira il voto' }));
    expect(voted.act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', []));
  });

  // Decision 2 (Q2): more votes per person, with a badge of the votes left.
  it('votes for more choices, up to the votes per person', async () => {
    const options = [option('o-1', 'Lun'), option('o-2', 'Mar'), option('o-3', 'Mer')];
    const { act, user } = renderPolls([poll({ max_choices: 2, options, my_option_ids: ['o-1'] })]);
    expect(screen.getByText('1 voto rimasto')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Mar' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', ['o-1', 'o-2']));
    await user.click(screen.getByRole('checkbox', { name: 'Lun' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', []));
    // Spec 54 Decision 3: a click on a card toggles it too.
    await user.click(screen.getAllByText('Mer')[0]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', ['o-1', 'o-3']));
    await user.click(screen.getAllByText('Lun')[0]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', []));
    document.body.innerHTML = '';

    const full = renderPolls([poll({ max_choices: 2, options, my_option_ids: ['o-1', 'o-3'] })]);
    await full.user.click(screen.getAllByText('Mar')[0]);
    expect(full.act).not.toHaveBeenCalled();
    expect(screen.getByText('0 voti rimasti')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mar' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Lun' })).toBeEnabled();
  });

  // Decision 5: the tally, the names on hover, and everyone having voted.
  it('shows the tally, who voted what, and when everyone has voted', async () => {
    const options = [
      option('o-1', 'D&D', { count: 2, voters: ['user-2', 'user-3'] }),
      option('o-2', 'PbtA', { count: 0, voters: [] }),
    ];
    const { user } = renderPolls(
      [poll({ options, voter_count: 2, can_vote: false, has_votes: true, not_voted: [] })],
      { can_manage: true },
    );
    expect(screen.getByText('2 voti')).toBeInTheDocument();
    expect(screen.getByText('Hanno votato tutti')).toBeInTheDocument();
    expect(screen.queryByText(/Mancano/)).not.toBeInTheDocument();
    await user.hover(screen.getByText('2 voti'));
    expect(await screen.findByText('Bianca, Carlo')).toBeInTheDocument();
    await user.hover(screen.getByText('0 voti'));
    expect(await screen.findByText('Nessun voto')).toBeInTheDocument();
  });

  it('lists who has not voted yet, and keeps counts without names', () => {
    const options = [option('o-1', 'D&D', { count: 1, voters: null }), option('o-2', 'PbtA', { count: 0, voters: null })];
    renderPolls([poll({ options, voter_count: 1, not_voted: ['user-3'], voters_visible: 'nobody' })], {
      can_manage: true,
    });
    expect(screen.getByText('Mancano: Carlo')).toBeInTheDocument();
    expect(screen.getByText('Anonimo')).toBeInTheDocument();
    expect(screen.getByText('1 voto')).not.toHaveAttribute('tabindex');
  });

  // Q5: a secret poll's tally stays hidden from a Player until revealed.
  it('keeps a secret tally hidden from a Player', () => {
    const options = [option('o-1', 'D&D', { count: null, voters: null }), option('o-2', 'PbtA', { count: null, voters: null })];
    renderPolls([poll({ results: 'hidden', tally_visible: false, options })]);
    expect(screen.getByText('Voto segreto')).toBeInTheDocument();
    expect(screen.getByText('Risultati segreti finché il Master non li rivela.')).toBeInTheDocument();
    expect(screen.queryByText(/voti?$/)).not.toBeInTheDocument();
  });

  // Decisions 5 and 6: the Master reveals, hides, closes and reopens.
  it('lets the Master reveal, hide, close and reopen', async () => {
    const { act, user } = renderPolls([poll({ results: 'hidden', can_vote: false })], { can_manage: true });
    await user.click(screen.getByRole('button', { name: 'Rivela i risultati' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.revealPoll('p-1', true));
    await user.click(screen.getByRole('button', { name: 'Chiudi sondaggio' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.closePoll('p-1', true));
    document.body.innerHTML = '';

    const done = renderPolls([poll({ results: 'hidden', revealed: true, closed: true, can_vote: false })], {
      can_manage: true,
    });
    expect(screen.getByText('Risultati rivelati')).toBeInTheDocument();
    expect(screen.getByText('Chiuso')).toBeInTheDocument();
    await done.user.click(screen.getByRole('button', { name: 'Nascondi i risultati' }));
    expect(done.act).toHaveBeenLastCalledWith(boardWrites.revealPoll('p-1', false));
    await done.user.click(screen.getByRole('button', { name: 'Riapri' }));
    expect(done.act).toHaveBeenLastCalledWith(boardWrites.closePoll('p-1', false));
  });

  // Decision 6: a closed poll shows its winner and the viewer's own vote.
  it('shows a closed poll read-only, with the winner and your vote', () => {
    const options = [
      option('o-1', 'D&D', { count: 2, winner: true }),
      option('o-2', 'PbtA', { count: 1 }),
    ];
    renderPolls([poll({ closed: true, can_vote: false, options, my_option_ids: ['o-2'], voter_count: 3, electorate: 3 })]);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Più votata')).toBeInTheDocument();
    expect(screen.getByLabelText('Il tuo voto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Riapri' })).not.toBeInTheDocument();
  });

  // Spec 54 Decisions 1-4: cards with a title and a Markdown description; a click on the card votes.
  it('shows choices as cards with descriptions, voted by a click on the card', async () => {
    const options = [
      option('o-1', 'Stanza 404', {
        description: 'Scenario d\'apertura. **Hotel** [mappa](https://example.com/map)',
        count: 3,
      }),
      option('o-2', 'Budōkan', { count: 1 }),
    ];
    const { act, user } = renderPolls([poll({ options, voter_count: 4, has_votes: true })]);
    const cards = document.querySelectorAll<HTMLElement>('.sz-poll-card');
    expect(screen.getByText('Hotel').tagName).toBe('STRONG');
    await user.click(screen.getByRole('link', { name: 'mappa' }));
    expect(act).not.toHaveBeenCalled();
    await user.click(screen.getByText(/Scenario d'apertura/));
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', ['o-1']));
    // The front face's title (the back holds the same title, hidden).
    await user.click(screen.getAllByText('Budōkan')[0]);
    expect(act).toHaveBeenLastCalledWith(boardWrites.vote('p-1', ['o-2']));
    document.body.innerHTML = '';
    // A click on the card already voted changes nothing.
    const voted = renderPolls([poll({ options, my_option_ids: ['o-1'] })]);
    await voted.user.click(screen.getAllByText('Stanza 404')[0]);
    expect(voted.act).not.toHaveBeenCalled();
    expect(cards[0].style.getPropertyValue('--share')).toBe('75%');
    expect(cards[1].style.getPropertyValue('--share')).toBe('25%');
    expect(cards[0]).toHaveAttribute('data-tally');
    expect(cards[0]).not.toHaveAttribute('data-flipped');
  });

  // Spec 54 Decisions 6-8: a revealed poll's cards turn over to title and share; the winner glows.
  it('turns the cards over once the results show, and back on request', async () => {
    const options = [
      option('o-1', 'Stanza 404', { description: 'Scenario', count: 1, winner: true }),
      option('o-2', 'Budōkan', { count: 1, winner: true }),
      option('o-3', 'Kabukichō', { count: 0 }),
    ];
    const { user } = renderPolls([
      poll({ results: 'hidden', revealed: true, options, voter_count: 2, has_votes: true, my_option_ids: ['o-2'] }),
    ]);
    const cards = document.querySelectorAll<HTMLElement>('.sz-poll-card');
    expect([...cards].map((card) => card.hasAttribute('data-flipped'))).toEqual([true, true, true]);
    expect([...cards].map((card) => card.hasAttribute('data-winner'))).toEqual([true, true, false]);
    expect(screen.getAllByLabelText('50% dei voti')).toHaveLength(2);
    expect(screen.getAllByLabelText('Più votata')).toHaveLength(2);
    expect(screen.getByLabelText('Il tuo voto')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mostra le opzioni' }));
    expect(cards[0]).not.toHaveAttribute('data-flipped');
    expect(cards[0]).not.toHaveAttribute('data-winner');
    expect(screen.getByRole('radio', { name: 'Budōkan' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Mostra i risultati' }));
    expect(cards[0]).toHaveAttribute('data-flipped');
    document.body.innerHTML = '';

    // Checkboxes on turned cards are out of the tab order too.
    renderPolls([poll({ results: 'hidden', revealed: true, max_choices: 2, options, voter_count: 2, has_votes: true })]);
    expect(document.querySelector('input[type="checkbox"]')).toHaveAttribute('tabindex', '-1');
  });

  it('is read-only in a closed session and while previewing', () => {
    renderPolls([poll({ my_option_ids: ['o-1'] })], { can_manage: true, rounds: closedRound });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Il tuo voto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica sondaggi' })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    renderPolls([poll()], {}, false);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  // Decision 5: a toast for the Master when the last voter votes live.
  it('tells the Master when everyone has voted, live', () => {
    const show = vi.mocked(notifications.show);
    show.mockClear();
    const value = (polls: unknown[], canManage = true) => {
      const raw = toSessionZero(rawSessionZero(pollBoard(polls, { can_manage: canManage })) as RawSessionZero);
      const module = shownModule(raw, null);
      return {
        board: viewOf(raw, module),
        module,
        members: roomMembers,
        act: vi.fn(),
        busy: false,
        writable: true,
        glowing: new Set<string>(),
      };
    };
    const ui = (polls: unknown[], canManage = true) => (
      <BoardContext.Provider value={value(polls, canManage)}>
        <PollBoard />
      </BoardContext.Provider>
    );
    const { rerender } = renderWithProviders(ui([poll({ voter_count: 1 })]));
    rerender(ui([poll({ voter_count: 2 })]));
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].message).toBe('Hanno votato tutti: «Quale sistema?»');
    rerender(ui([poll({ voter_count: 2 })]));
    expect(show).toHaveBeenCalledTimes(1);
    rerender(ui([poll({ voter_count: 1 })], false));
    rerender(ui([poll({ voter_count: 2 })], false));
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('Edit polls', () => {
  async function openEditor(polls: unknown[] = []) {
    const rendered = renderPolls(polls, { can_manage: true });
    await rendered.user.click(screen.getByRole('button', { name: 'Modifica sondaggi' }));
    return { ...rendered, dialog: await screen.findByRole('dialog', { name: 'Modifica sondaggi' }) };
  }

  // Decision 2: a new poll with its choices and settings, saved together.
  it('writes a new poll with its settings', async () => {
    const { act, user, dialog } = await openEditor();
    const save = within(dialog).getByRole('button', { name: 'Salva' });
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi sondaggio' }));
    expect(save).toBeDisabled();
    expect(within(dialog).getByText('Ogni sondaggio ha bisogno della domanda e di tutte le scelte.')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Domanda' }), 'Quando giochiamo?');
    await user.type(within(dialog).getByRole('textbox', { name: 'Suggerimento (facoltativo)' }), 'Sera');
    await user.type(within(dialog).getByRole('textbox', { name: 'Scelta 1' }), 'Lun');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Descrizione della scelta 1 (facoltativa)' }),
      'Dopo cena',
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Scelta 2' }), 'lun');
    expect(within(dialog).getByText('Due scelte dello stesso sondaggio sono uguali.')).toBeInTheDocument();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Scelta 2' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Scelta 2' }), 'Mar');
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi scelta' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Scelta 3' }), 'Mer');

    const votes = within(dialog).getByRole('textbox', { name: 'Voti a testa' });
    await user.clear(votes);
    await user.type(votes, '3');
    await user.click(within(dialog).getByRole('switch', { name: 'Vota anche il Master' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Voti nominativi' }));
    await user.click(await screen.findByRole('option', { name: 'Tutti' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Risultati' }));
    await user.click(await screen.findByRole('option', { name: 'Segreti fino alla rivelazione' }));
    await user.click(within(dialog).getByRole('button', { name: 'Rimuovi la scelta 3' }));
    expect(votes).toHaveValue('2');

    await user.click(save);
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.setPolls('m-poll', [
        {
          id: null,
          body: 'Quando giochiamo?',
          hint: 'Sera',
          maxChoices: 2,
          masterVotes: true,
          votersVisible: 'everyone',
          results: 'hidden',
          options: [
            { id: null, body: 'Lun', description: 'Dopo cena' },
            { id: null, body: 'Mar', description: '' },
          ],
        },
      ]),
      expect.any(Function),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }, 20_000);

  // Decision 3: settings lock once a poll has votes; polls reorder and go.
  it('locks a voted poll\'s settings, reorders and removes polls', async () => {
    const { act, user, dialog } = await openEditor([
      poll({ has_votes: true, hint: 'Uno solo' }),
      poll({ id: 'p-2', body: 'Che tono?', options: [option('o-3', 'Cupo'), option('o-4', 'Leggero')] }),
    ]);
    expect(within(dialog).getByText('Questo sondaggio ha già dei voti: le impostazioni sono bloccate.')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('textbox', { name: 'Voti a testa' })[0]).toBeDisabled();
    expect(within(dialog).getAllByRole('button', { name: /Rimuovi la scelta/ })[0]).toBeDisabled();

    await user.click(within(dialog).getAllByRole('button', { name: 'Sposta giù' })[0]);
    expect(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[0]).toHaveValue('Che tono?');
    await user.click(within(dialog).getAllByRole('button', { name: 'Sposta su' })[1]);
    expect(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[0]).toHaveValue('Quale sistema?');
    await user.type(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[1], '!');
    expect(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[0]).toHaveValue('Quale sistema?');
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[1]);
    const votes = within(dialog).getByRole('textbox', { name: 'Voti a testa' });
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.setPolls('m-poll', [
        {
          id: 'p-1',
          body: 'Quale sistema?',
          hint: 'Uno solo',
          maxChoices: 1,
          masterVotes: false,
          votersVisible: 'master',
          results: 'live',
          options: [
            { id: 'o-1', body: 'D&D', description: '' },
            { id: 'o-2', body: 'PbtA', description: '' },
          ],
        },
      ]),
      expect.any(Function),
    );
    expect(votes).toBeDisabled();
  });

  it('treats an emptied votes-per-person field as 1', async () => {
    const { act, user, dialog } = await openEditor([poll()]);
    await user.clear(within(dialog).getByRole('textbox', { name: 'Voti a testa' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    const [write] = act.mock.lastCall as [{ json: { polls: { max_choices: number }[] } }];
    expect(write.json.polls[0].max_choices).toBe(1);
  });

  it('caps polls and choices', async () => {
    const many = Array.from({ length: 20 }, (_, index) => option(`o-${index}`, `Scelta ${index}`));
    const { dialog } = await openEditor([
      poll({ options: many }),
      ...Array.from({ length: 9 }, (_, index) => poll({ id: `p-${index + 2}` })),
    ]);
    expect(within(dialog).getByRole('button', { name: 'Aggiungi sondaggio' })).toBeDisabled();
    expect(within(dialog).getAllByRole('button', { name: 'Aggiungi scelta' })[0]).toBeDisabled();
  }, 20_000);

  it('flags a poll outside 2 to 20 choices', async () => {
    const { dialog } = await openEditor([poll({ options: [option('o-1', 'Solo')] })]);
    expect(within(dialog).getByText('Ogni sondaggio ha da 2 a 20 scelte.')).toBeInTheDocument();
  });

  // Like "Edit questions": closing with unsaved changes asks first.
  it('asks before dropping unsaved changes, and closes at once without any', async () => {
    const { user, dialog } = await openEditor([poll()]);
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Modifica sondaggi' }));
    const again = await screen.findByRole('dialog', { name: 'Modifica sondaggi' });
    await user.type(within(again).getByRole('textbox', { name: 'Domanda' }), '!');
    await user.click(within(again).getByRole('button', { name: 'Annulla' }));
    expect(within(again).getByText(/modifiche non salvate/i)).toBeInTheDocument();
    await user.click(within(again).getByRole('button', { name: /Continua/ }));
    await user.click(within(again).getByRole('button', { name: 'Annulla' }));
    await user.click(within(again).getByRole('button', { name: /Scarta/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
