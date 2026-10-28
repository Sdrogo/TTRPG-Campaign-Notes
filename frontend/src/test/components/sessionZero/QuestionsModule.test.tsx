import { cleanup, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ANSWER_SAVE_DELAY_MS, QuestionsBoard } from '../../../components/sessionZero/QuestionsModule';
import { boardWrites } from '../../../lib/sessionZero';
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
    expect(screen.getByText('Ireena')).toBeInTheDocument();
    expect(screen.getByText('Un segreto? · Privata')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
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

  it('only shows a closed session\'s questions and answers', () => {
    renderQuestions({ board: master({}, { rounds: closed }) });
    expect(screen.queryByRole('button', { name: 'Modifica domande' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rivela le risposte' })).not.toBeInTheDocument();
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

  it('starts an empty list with the Name question, and cancels', async () => {
    const { act, user, dialog } = await openEditor({ questions: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Aggiungi domanda' }));
    expect(within(dialog).getByRole('combobox', { name: 'Dove va la risposta' })).toHaveValue('Nome');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
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
