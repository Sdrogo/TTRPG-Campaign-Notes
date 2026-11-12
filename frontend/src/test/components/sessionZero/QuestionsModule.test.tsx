import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ANSWER_SAVE_DELAY_MS, QuestionsBoard } from '../../../components/sessionZero/QuestionsModule';
import { BoardContext } from '../../../components/sessionZero/boardContext';
import { boardWrites, shownModule, toSessionZero, viewOf, type RawSessionZero } from '../../../lib/sessionZero';
import { rawSessionZero } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import type { Tag } from '../../../types/tag';
import { members, renderBoard } from './harness';

const tags: Tag[] = [
  { id: 'tag-pc', name: 'PC', category: null, mainPosition: null },
  { id: 'tag-npc', name: 'NPC', category: null, mainPosition: null },
];

const questions = [
  { id: 'q-name', position: 0, body: 'Come ti chiami?', hint: 'Il nome del tuo PG', target: 'name', tag_id: null },
  { id: 'q-sub', position: 1, body: 'In due parole?', hint: null, target: 'subtitle', tag_id: null },
  { id: 'q-desc', position: 2, body: 'Da dove vieni?', hint: null, target: 'description', tag_id: null },
  { id: 'q-note', position: 3, body: 'Un segreto?', hint: null, target: 'note', tag_id: null },
  { id: 'q-npc', position: 4, body: 'Un PNG legato a te?', hint: null, target: 'document', tag_id: 'tag-npc' },
];

function answer(questionId: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    question_id: questionId,
    user_id: 'user-2',
    body,
    note_private: false,
    updated_at: '2026-10-28T09:00:00Z',
    mine: false,
    ...overrides,
  };
}

/** A session whose current step is a Questions one, with `overrides` on its content. */
function questionsBoard(overrides: Record<string, unknown> = {}, board: Record<string, unknown> = {}) {
  return {
    modules: [
      {
        id: 'm-q',
        kind: 'questions',
        position: 0,
        columns: [],
        questions: {
          tag_id: 'tag-pc',
          answers_revealed: false,
          players_bypass_creation_rule: true,
          questions,
          answers: [],
          documents: [],
          can_create: false,
          creatable: 0,
          ...overrides,
        },
      },
    ],
    current_module_id: 'm-q',
    ...board,
  };
}

const closed = [{ id: 'round-1', number: 1, title: null, started_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-20T09:00:00Z' }];

function renderQuestions(options: Parameters<typeof renderBoard>[1] = {}) {
  return renderBoard(
    <Routes>
      <Route path="/" element={<QuestionsBoard roomId="room-1" tags={tags} />} />
      <Route path="/rooms/room-1/documents/:documentId" element={<p>Pagina del Documento</p>} />
    </Routes>,
    options,
  );
}

describe('QuestionsBoard', () => {
  it('shows nothing on a step that is not a Questions one', () => {
    renderBoard(<QuestionsBoard roomId="room-1" tags={tags} />);
    expect(screen.queryByRole('region', { name: 'Domande' })).not.toBeInTheDocument();
  });
});

describe('QuestionsBoard for the Master', () => {
  const master = (overrides: Record<string, unknown> = {}, board: Record<string, unknown> = {}) =>
    questionsBoard(overrides, { can_manage: true, ...board });

  // Spec 47 Decision 9: the questions, where each answer goes, the main Documents' Tag.
  it('shows the questions and changes the settings at once', async () => {
    const { act, user } = renderQuestions({ board: master() });
    const section = screen.getByRole('region', { name: 'Domande' });
    expect(section).toHaveTextContent('1. Come ti chiami?');
    expect(section).toHaveTextContent('Il nome del tuo PG');
    expect(section).toHaveTextContent('Nuovo Documento · NPC');

    await user.click(screen.getByRole('combobox', { name: 'Tag dei Documenti dei Player' }));
    await user.click(await screen.findByRole('option', { name: 'NPC' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.setQuestionsTag('m-q', 'tag-npc'));

    await user.click(screen.getByRole('switch', { name: /anche se la Stanza non lo permette/ }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.setCreationBypass('m-q', false));
  });

  // Decisions 10 and 11: every Player's answers, reveal, and "everyone's Documents".
  it('follows the answers, reveals them and creates everyone\'s Documents', async () => {
    const board = master({
      answers: [answer('q-name', 'Ireena'), answer('q-note', 'Sono una sposa di vampiro', { note_private: true })],
      documents: [{ user_id: 'user-2', question_id: null, document_id: 'doc-9', mine: false }],
      creatable: 2,
    });
    const { act, user } = renderQuestions({ board });
    expect(screen.getByText('Ogni Player vede solo le proprie risposte.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Bianca/ }));
    expect(screen.getByText('2/5 risposte')).toBeInTheDocument();
    // Spec 70: the Master's view of the answers is editable in place.
    expect(await screen.findByRole('textbox', { name: 'Come ti chiami?' })).toHaveValue('Ireena');
    expect(screen.getByRole('checkbox', { name: 'Privata' })).toBeChecked();
    expect(screen.getByText('Apri il Documento').closest('a')).toHaveAttribute('href', '/rooms/room-1/documents/doc-9');

    await user.click(screen.getByRole('button', { name: 'Rivela le risposte' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.revealAnswers('m-q', true));
    await user.click(screen.getByRole('button', { name: 'Crea i Documenti di tutti (2)' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.createEveryoneDocuments('m-q'));
  });

  it('hides revealed answers again, and has nobody to create for', async () => {
    const { act, user } = renderQuestions({ board: master({ answers_revealed: true }) });
    expect(screen.getByText('Tutti i membri vedono le risposte di tutti.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crea i Documenti di tutti (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Nascondi le risposte' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.revealAnswers('m-q', false));
  });

  it('says when there are no questions yet, or no Players', () => {
    renderQuestions({ board: master({ questions: [] }) });
    expect(screen.getByText('Ancora nessuna domanda: scrivile con «Modifica domande».')).toBeInTheDocument();
    expect(screen.queryByText('Risposte')).not.toBeInTheDocument();
    document.body.innerHTML = '';

    renderQuestions({ board: master(), roomMembers: [] });
    expect(screen.getByText('Nessun Player nella Stanza.')).toBeInTheDocument();
  });

  it('only shows a closed session\'s questions, but still edits its answers', async () => {
    const { act, user } = renderQuestions({ board: master({ answers: [answer('q-name', 'Ireena')] }, { rounds: closed }) });
    expect(screen.queryByRole('button', { name: 'Modifica domande' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rivela le risposte' })).not.toBeInTheDocument();
    // Spec 70 Decision 8: the Master fixes a past session's answers too.
    await user.click(screen.getByRole('button', { name: /Bianca/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Da dove vieni?' }), 'Barovia');
    await user.tab();
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.saveAnswersFor('m-q', 'user-2', [{ questionId: 'q-desc', body: 'Barovia' }]),
    );
  });

  // Spec 70: the Master writes, changes and clears a Player's answers; the Private tick stays theirs.
  it('edits a Player\'s answers in place, saved as they type', async () => {
    const board = master({ answers: [answer('q-name', 'Ireena'), answer('q-note', 'Un segreto', { note_private: true })] });
    const { act, user } = renderQuestions({ board });
    await user.click(screen.getByRole('button', { name: /Bianca/ }));
    expect(screen.getByText('Le modifiche si salvano mentre scrivi. Il Player le vede subito.')).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Privata' })).toBeDisabled();

    const name = screen.getByRole('textbox', { name: 'Come ti chiami?' });
    await user.clear(name);
    await user.type(name, 'Ireena Kolyana');
    expect(act).not.toHaveBeenCalled();
    await vi.waitFor(
      () =>
        expect(act).toHaveBeenLastCalledWith(
          boardWrites.saveAnswersFor('m-q', 'user-2', [{ questionId: 'q-name', body: 'Ireena Kolyana' }]),
        ),
      { timeout: ANSWER_SAVE_DELAY_MS * 3 },
    );
    await user.clear(screen.getByRole('textbox', { name: 'Un segreto?' }));
    await user.tab();
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.saveAnswersFor('m-q', 'user-2', [{ questionId: 'q-note', body: '' }]),
    );
  });

  it('only reads the answers while previewing the Room as a member', async () => {
    const { user } = renderQuestions({ board: master({ answers: [answer('q-name', 'Ireena')] }), writable: false });
    await user.click(screen.getByRole('button', { name: /Bianca/ }));
    expect(screen.queryByRole('textbox', { name: 'Come ti chiami?' })).not.toBeInTheDocument();
    expect(screen.getByText('Ireena')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});

describe('Edit questions', () => {
  async function openEditor(overrides: Record<string, unknown> = {}) {
    const rendered = renderQuestions({ board: questionsBoard(overrides, { can_manage: true }) });
    await rendered.user.click(screen.getByRole('button', { name: 'Modifica domande' }));
    return { ...rendered, dialog: await screen.findByRole('dialog', { name: 'Modifica domande' }) };
  }

  it('edits, reorders, removes and adds questions, then saves them together', async () => {
    const { act, user, dialog } = await openEditor({ questions: questions.slice(0, 2) });
    const ups = within(dialog).getAllByRole('button', { name: 'Sposta su' });
    expect(ups[0]).toBeDisabled();
    expect(within(dialog).getAllByRole('button', { name: 'Sposta giù' })[1]).toBeDisabled();
    await user.click(ups[1]);
    expect(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[0]).toHaveValue('In due parole?');
    await user.click(within(dialog).getAllByRole('button', { name: 'Sposta giù' })[0]);
    expect(within(dialog).getAllByRole('textbox', { name: 'Domanda' })[0]).toHaveValue('Come ti chiami?');

    // A new question asks for the description once there is a Name one; with no text it can't be saved.
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi domanda' }));
    expect(within(dialog).getByText('Ogni domanda ha bisogno di un testo.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Salva' })).toBeDisabled();
    const third = within(dialog).getAllByRole('textbox', { name: 'Domanda' })[2];
    await user.type(third, 'Chi ti cerca?');
    await user.type(within(dialog).getAllByRole('textbox', { name: 'Suggerimento (facoltativo)' })[2], 'Un nemico');
    expect(within(dialog).getAllByRole('combobox', { name: 'Dove va la risposta' })[2]).toHaveValue('Descrizione');

    // "New Document" asks for its Tag.
    await user.click(within(dialog).getAllByRole('combobox', { name: 'Dove va la risposta' })[2]);
    await user.click(await screen.findByRole('option', { name: 'Nuovo Documento' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Tag del nuovo Documento' }));
    await user.click(await screen.findByRole('option', { name: 'NPC' }));

    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[1]);
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.setQuestions('m-q', [
        { id: 'q-name', body: 'Come ti chiami?', hint: 'Il nome del tuo PG', target: 'name', tagId: null },
        { id: null, body: 'Chi ti cerca?', hint: 'Un nemico', target: 'document', tagId: 'tag-npc' },
      ]),
      expect.any(Function),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts an empty list with the Name question, and asks before dropping it', async () => {
    const { act, user, dialog } = await openEditor({ questions: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi domanda' }));
    expect(within(dialog).getByRole('combobox', { name: 'Dove va la risposta' })).toHaveValue('Nome');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(within(dialog).getByText('Hai modifiche non salvate.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continua a modificare' }));
    expect(within(dialog).getByRole('combobox', { name: 'Dove va la risposta' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await user.click(within(dialog).getByRole('button', { name: 'Scarta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
  });

  it('closes at once when nothing changed', async () => {
    const { user, dialog } = await openEditor({ questions: questions.slice(0, 1) });
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops at the most questions a step holds', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...questions[2],
      id: `q-${index}`,
      position: index,
      target: index === 0 ? 'name' : 'none',
    }));
    const { dialog } = await openEditor({ questions: many });
    expect(within(dialog).getByRole('button', { name: 'Aggiungi domanda' })).toBeDisabled();
  });
});

describe('QuestionsBoard for a Player', () => {
  const mine = (questionId: string, body: string, overrides: Record<string, unknown> = {}) =>
    answer(questionId, body, { user_id: 'user-1', mine: true, ...overrides });

  it('waits for the Master\'s questions', () => {
    renderQuestions({ board: questionsBoard({ questions: [] }) });
    expect(screen.getByText('Il Master non ha ancora scritto le domande.')).toBeInTheDocument();
  });

  // Decision 10: one field per question, saved as they type.
  it('saves the answers when a field is left, when typing pauses and at once for "Private"', async () => {
    const { act, user } = renderQuestions({ board: questionsBoard({ answers: [mine('q-name', 'Ireena')] }) });
    const name = screen.getByRole('textbox', { name: 'Come ti chiami?' });
    expect(name).toHaveValue('Ireena');
    expect(screen.getByText('Diventa il nome del tuo Documento.')).toBeInTheDocument();
    await user.type(name, ' Kolyana');
    expect(act).not.toHaveBeenCalled();
    await user.tab();
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.saveAnswers('m-q', [{ questionId: 'q-name', body: 'Ireena Kolyana', notePrivate: false }]),
    );
    await user.tab();
    expect(act).toHaveBeenCalledTimes(1);

    await user.type(screen.getByRole('textbox', { name: 'Da dove vieni?' }), 'Barovia');
    await vi.waitFor(
      () =>
        expect(act).toHaveBeenLastCalledWith(
          boardWrites.saveAnswers('m-q', [{ questionId: 'q-desc', body: 'Barovia', notePrivate: false }]),
        ),
      { timeout: ANSWER_SAVE_DELAY_MS * 3 },
    );

    await user.click(screen.getByRole('checkbox', { name: 'Privata' }));
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.saveAnswers('m-q', [{ questionId: 'q-note', body: '', notePrivate: true }]),
    );
  });

  it('sends what is still unsent when the form goes away', async () => {
    const { act, user } = renderQuestions({ board: questionsBoard() });
    await user.type(screen.getByRole('textbox', { name: 'In due parole?' }), 'Sposa');
    // The form goes away when another step is opened.
    cleanup();
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.saveAnswers('m-q', [{ questionId: 'q-sub', body: 'Sposa', notePrivate: false }]),
    );
  });

  // Decision 11: "Create my Document" opens the new Document.
  it('creates their Document and opens it', async () => {
    const created = questionsBoard({
      documents: [{ user_id: 'user-1', question_id: null, document_id: 'doc-new', mine: true }],
    });
    const { act, user } = renderQuestions({
      board: questionsBoard({ answers: [mine('q-name', 'Ireena')], can_create: true }),
      next: created,
    });
    await user.click(screen.getByRole('button', { name: 'Crea il mio Documento' }));
    expect(act).toHaveBeenCalledWith(boardWrites.createMyDocument('m-q'), expect.any(Function));
    expect(await screen.findByText('Pagina del Documento')).toBeInTheDocument();
  });

  it('stays on the step when the answer has no Document of theirs', async () => {
    const { user } = renderQuestions({
      board: questionsBoard({ answers: [mine('q-name', 'Ireena')], can_create: true }),
      next: { modules: [] },
    });
    await user.click(screen.getByRole('button', { name: 'Crea il mio Documento' }));
    expect(screen.getByRole('button', { name: 'Crea il mio Documento' })).toBeInTheDocument();
  });

  it('opens the Document they already made', () => {
    renderQuestions({
      board: questionsBoard({ documents: [{ user_id: 'user-1', question_id: null, document_id: 'doc-1', mine: true }] }),
    });
    expect(screen.getByRole('link', { name: 'Apri il tuo Documento' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-1');
  });

  it('says what creating the Document waits for', () => {
    renderQuestions({ board: questionsBoard() });
    expect(screen.getByText('Rispondi alla domanda sul nome per creare il tuo Documento.')).toBeInTheDocument();
    document.body.innerHTML = '';
    renderQuestions({ board: questionsBoard({ answers: [mine('q-name', 'Ireena')] }) });
    expect(screen.getByText('Il Master creerà il tuo Documento.')).toBeInTheDocument();
  });

  it('only shows a closed session\'s answers', () => {
    renderQuestions({ board: questionsBoard({ answers: [mine('q-note', 'Segreto', { note_private: true })] }, { rounds: closed }) });
    expect(screen.getByRole('textbox', { name: 'Un segreto?' })).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'Privata' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Privata' })).toBeChecked();
    expect(screen.queryByText(/si salvano mentre scrivi/)).not.toBeInTheDocument();
    expect(screen.queryByText(/per creare il tuo Documento/)).not.toBeInTheDocument();
  });

  // Decision 10, Q2: once revealed, everyone's answers, read-only.
  it('shows the other Players\' answers once the Master reveals them', async () => {
    const roomMembers = [...members, { ...members[0], userId: 'user-3', displayName: 'Carlo' }];
    const { user } = renderQuestions({
      board: questionsBoard({ answers_revealed: true, answers: [mine('q-name', 'Ireena'), answer('q-name', 'Ismark')] }),
      roomMembers,
    });
    expect(screen.getByText('Le risposte di tutti')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Carlo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bianca/ }));
    expect(screen.getByText('Ismark')).toBeInTheDocument();
  });
});

// Spec 70 Decision 6: the Master's edits reach the Player's open form, but
// never a field the Player is typing in.
describe('The Player\'s form and the Master\'s edits', () => {
  const mine = (questionId: string, body: string) => answer(questionId, body, { user_id: 'user-1', mine: true });

  type Stored = ReturnType<typeof mine>[];

  /** The Player's form; each click on "Arriva un aggiornamento" stores the next answers in `updates`. */
  function Live({ act, updates }: { act: ReturnType<typeof vi.fn>; updates: Stored[] }) {
    const [step, setStep] = useState(0);
    const answers = step === 0 ? [mine('q-name', 'Ireena'), mine('q-desc', 'Barovia')] : updates[step - 1];
    const raw = toSessionZero(rawSessionZero(questionsBoard({ answers })) as RawSessionZero);
    const module = shownModule(raw, null);
    const value = { board: viewOf(raw, module), module, members, act: act as never, busy: false, writable: true, glowing: new Set<string>() };
    return (
      <BoardContext.Provider value={value}>
        <QuestionsBoard roomId="room-1" tags={tags} />
        <button type="button" onClick={() => setStep(step + 1)}>
          Arriva un aggiornamento
        </button>
      </BoardContext.Provider>
    );
  }
  const update = () => screen.getByRole('button', { name: 'Arriva un aggiornamento' }).click();

  it('shows the new text in fields the Player is not typing in', async () => {
    const act = vi.fn();
    renderWithProviders(<Live act={act} updates={[[mine('q-name', 'Ireena Kolyana'), mine('q-desc', 'Vallaki')]]} />);
    const user = userEvent.setup();
    // The Player changed their name and left the field (sent)...
    await user.type(screen.getByRole('textbox', { name: 'Come ti chiami?' }), '!');
    await user.tab();
    expect(act).toHaveBeenCalledTimes(1);
    // ...and is typing in "Da dove vieni?" when the Master's edit of both arrives.
    const description = screen.getByRole('textbox', { name: 'Da dove vieni?' });
    await user.type(description, ' e oltre');
    update();
    expect(await screen.findByDisplayValue('Ireena Kolyana')).toBeInTheDocument();
    expect(description).toHaveValue('Barovia e oltre');
  });

  it('keeps what the Player sent until their save is stored, then follows the stored answer again', async () => {
    const act = vi.fn();
    const updates = [
      // Another field changes while the Player's save is on its way...
      [mine('q-name', 'Ireena'), mine('q-desc', 'Vallaki')],
      // ...then it is stored (cleaned by the server)...
      [mine('q-name', 'Ireena!'), mine('q-desc', 'Vallaki')],
      // ...and a later edit of that field shows.
      [mine('q-name', 'Ireena Kolyana'), mine('q-desc', 'Vallaki')],
    ];
    renderWithProviders(<Live act={act} updates={updates} />);
    const user = userEvent.setup();
    const name = screen.getByRole('textbox', { name: 'Come ti chiami?' });
    await user.type(name, '!  ');
    await user.tab();
    expect(act).toHaveBeenCalledTimes(1);
    update();
    expect(await screen.findByDisplayValue('Vallaki')).toBeInTheDocument();
    expect(name).toHaveValue('Ireena!  ');
    update();
    await vi.waitFor(() => expect(name).toHaveValue('Ireena!'));
    update();
    await vi.waitFor(() => expect(name).toHaveValue('Ireena Kolyana'));
  });
});

// Spec 70 Decisions 10-14: a step without a Name question.
describe('A step without a Name question', () => {
  const noName = [
    { id: 'q-snack', position: 0, body: 'Snack preferito?', hint: null, target: 'none', tag_id: null },
    { id: 'q-npc', position: 1, body: 'Un PNG legato a te?', hint: null, target: 'document', tag_id: 'tag-npc' },
  ];

  it('makes only the Player\'s "New Document" ones', async () => {
    const board = questionsBoard({
      questions: noName,
      answers: [answer('q-npc', 'Arik', { user_id: 'user-1', mine: true })],
      can_create: true,
    });
    const { act, user } = renderQuestions({ board });
    expect(screen.queryByRole('button', { name: 'Crea il mio Documento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crea i miei Documenti' }));
    expect(act).toHaveBeenLastCalledWith(boardWrites.createMyDocument('m-q'));
  });

  it('tells the Player when the Master makes them, and says nothing when there is nothing to make', () => {
    renderQuestions({
      board: questionsBoard({
        questions: noName,
        answers: [answer('q-npc', 'Arik', { user_id: 'user-1', mine: true })],
      }),
    });
    expect(screen.getByText('Il Master creerà i tuoi Documenti.')).toBeInTheDocument();
    cleanup();
    renderQuestions({ board: questionsBoard({ questions: noName.slice(0, 1) }) });
    expect(screen.queryByText(/creerà/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nome/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crea/ })).not.toBeInTheDocument();
  });

  it('hides the Tag of the Players\' Documents, and "everyone\'s Documents" when nothing is made', () => {
    renderQuestions({ board: questionsBoard({ questions: noName }, { can_manage: true }) });
    expect(screen.queryByRole('combobox', { name: 'Tag dei Documenti dei Player' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crea i Documenti di tutti (0)' })).toBeInTheDocument();
    cleanup();
    renderQuestions({ board: questionsBoard({ questions: noName.slice(0, 1) }, { can_manage: true }) });
    expect(screen.queryByRole('button', { name: /Crea i Documenti di tutti/ })).not.toBeInTheDocument();
  });

  it('lets the Master drop the Name question and offers no target that needs it', async () => {
    const { act, user } = renderQuestions({ board: questionsBoard({ questions: questions.slice(0, 1) }, { can_manage: true }) });
    await user.click(screen.getByRole('button', { name: 'Modifica domande' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica domande' });
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi domanda' }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Rimuovi' })[0]);
    // The new question doesn't fill a Document now that there is no Name question.
    await user.type(within(dialog).getByRole('textbox', { name: 'Domanda' }), 'Chi ti cerca?');
    const target = within(dialog).getByRole('combobox', { name: 'Dove va la risposta' });
    expect(target).toHaveValue('Descrizione');
    expect(within(dialog).getByText('Sottotitolo, Descrizione e Nota richiedono una domanda per il Nome.')).toBeInTheDocument();
    await user.click(target);
    expect(await screen.findByRole('option', { name: 'Nota' })).toHaveAttribute('data-combobox-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Non nel Documento' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(act).toHaveBeenLastCalledWith(
      boardWrites.setQuestions('m-q', [{ id: null, body: 'Chi ti cerca?', hint: '', target: 'none', tagId: null }]),
      expect.any(Function),
    );
  });
});
