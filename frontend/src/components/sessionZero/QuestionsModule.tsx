import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Accordion,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import { useBackState } from '../../lib/backNav';
import {
  MAX_ANSWER_LENGTH,
  MAX_DOCUMENT_QUESTIONS,
  MAX_HINT_LENGTH,
  MAX_NAME_ANSWER_LENGTH,
  MAX_QUESTIONS,
  MAX_QUESTION_LENGTH,
  MAX_SUBTITLE_ANSWER_LENGTH,
  MAIN_DOCUMENT_TARGETS,
  QUESTION_TARGETS,
  boardWrites,
  questionsProblem,
  type QuestionDraft,
} from '../../lib/sessionZero';
import type { Tag } from '../../types/tag';
import type { Answer, Question, QuestionsStep, SessionZero, SessionZeroModule } from '../../types/sessionZero';
import { useBoard } from './boardContext';

/** How long typing pauses before the answers are saved (Decision 10). */
export const ANSWER_SAVE_DELAY_MS = 800;

interface QuestionsBoardProps {
  roomId: string;
  /** The Room's Tags, for the Documents the answers make. */
  tags: Tag[];
}

/**
 * A Questions step (spec 47 Decisions 9-11): the Master writes the questions
 * and follows the answers, one row per Player; a Player answers in a form
 * saved as they type and makes their Document from it.
 */
export function QuestionsBoard({ roomId, tags }: QuestionsBoardProps) {
  const { t } = useTranslation();
  const { board, module, writable } = useBoard();
  const step = module?.questions;
  if (!module || !step) return null;
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  const editable = open && writable;
  return (
    <Box component="section" aria-label={t('sessionZero.modules.kinds.questions')} className="sz-questions">
      {board.canManage ? (
        <MasterQuestions roomId={roomId} tags={tags} module={module} step={step} editable={editable} />
      ) : (
        <PlayerQuestions roomId={roomId} module={module} step={step} editable={editable} />
      )}
    </Box>
  );
}

interface StepProps {
  roomId: string;
  module: SessionZeroModule;
  step: QuestionsStep;
  editable: boolean;
}

/** A question's text, where its answer goes and its hint, read-only. */
function QuestionLine({ question, index, tags }: { question: Question; index: number; tags: Tag[] }) {
  const { t } = useTranslation();
  const tag = tags.find((candidate) => candidate.id === question.tagId);
  return (
    <Paper withBorder radius="sm" p="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Text size="sm" fw={500}>
          {index + 1}. {question.body}
        </Text>
        <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
          {t(`sessionZero.questions.targets.${question.target}`)}
          {tag && ` · ${tag.name}`}
        </Badge>
      </Group>
      {question.hint && (
        <Text size="xs" c="dimmed">
          {question.hint}
        </Text>
      )}
    </Paper>
  );
}

/** The Master's side: settings, the questions, and every Player's answers. */
function MasterQuestions({ roomId, tags, module, step, editable }: StepProps & { tags: Tag[] }) {
  const { t } = useTranslation();
  const { act, busy, members, writable } = useBoard();
  const [editing, setEditing] = useState(false);
  const tagSelectId = useId();
  const players = members.filter((member) => member.role === 'player');
  // Spec 70 Decisions 11-13: the Players' own Documents need a Name question; "New Document" ones don't.
  const hasName = step.questions.some((question) => question.target === 'name');
  const makesDocuments = hasName || step.questions.some((question) => question.target === 'document');
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));
  return (
    <Stack gap="md">
      <Stack gap="xs">
        {/* Title, settings and "Edit questions" share one row, wrapping on a narrow screen. */}
        <Group gap="md" align="center">
          <Title order={2} fz="h3">
            {t('sessionZero.questions.title')}
          </Title>
          {editable && (
            <>
              {hasName && (
                <Group gap={6} wrap="nowrap">
                  <Text component="label" htmlFor={tagSelectId} size="xs" fw={500}>
                    {t('sessionZero.questions.tag')}
                  </Text>
                  <Select
                    id={tagSelectId}
                    size="xs"
                    w={140}
                    placeholder={t('sessionZero.questions.noTag')}
                    clearable
                    data={tagOptions}
                    value={step.tagId}
                    disabled={busy}
                    onChange={(value) => act(boardWrites.setQuestionsTag(module.id, value))}
                  />
                </Group>
              )}
              <Switch
                size="sm"
                label={t('sessionZero.questions.bypass')}
                checked={step.playersBypassCreationRule}
                disabled={busy}
                onChange={(event) => act(boardWrites.setCreationBypass(module.id, event.currentTarget.checked))}
              />
              <Button size="compact-sm" variant="default" ml="auto" onClick={() => setEditing(true)}>
                {t('sessionZero.questions.edit')}
              </Button>
            </>
          )}
        </Group>
        {step.questions.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('sessionZero.questions.noneMaster')}
          </Text>
        ) : (
          step.questions.map((question, index) => (
            <QuestionLine key={question.id} question={question} index={index} tags={tags} />
          ))
        )}
      </Stack>
      {step.questions.length > 0 && (
        <Stack gap="xs">
          <Group justify="space-between">
            <Title order={3} fz="h5">
              {t('sessionZero.questions.answers')}
            </Title>
            {editable && (
              <Group gap="xs">
                <Button
                  size="compact-sm"
                  variant="default"
                  disabled={busy}
                  onClick={() => act(boardWrites.revealAnswers(module.id, !step.answersRevealed))}
                >
                  {step.answersRevealed ? t('sessionZero.questions.hide') : t('sessionZero.questions.reveal')}
                </Button>
                {makesDocuments && (
                  <Button
                    size="compact-sm"
                    disabled={busy || step.creatable === 0}
                    onClick={() => act(boardWrites.createEveryoneDocuments(module.id))}
                  >
                    {t('sessionZero.questions.createAll', {
                      count: step.creatable,
                    })}
                  </Button>
                )}
              </Group>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {step.answersRevealed ? t('sessionZero.questions.revealedHint') : t('sessionZero.questions.privateHint')}
          </Text>
          <AnswersByPlayer
            roomId={roomId}
            module={module}
            step={step}
            userIds={players.map((player) => player.userId)}
            canEdit={writable}
          />
        </Stack>
      )}
      {editing && <QuestionsEditor module={module} step={step} tags={tags} onClose={() => setEditing(false)} />}
    </Stack>
  );
}

/** One row per Player: how many questions they answered, their answers and their Document. */
function AnswersByPlayer({
  roomId,
  module,
  step,
  userIds,
  canEdit = false,
}: {
  roomId: string;
  module: SessionZeroModule;
  step: QuestionsStep;
  userIds: string[];
  /** The Master edits the answers in place (spec 70), in an open or closed session. */
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const { act, members } = useBoard();
  if (userIds.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t('sessionZero.questions.noPlayers')}
      </Text>
    );
  }
  return (
    <Accordion variant="separated" multiple>
      {userIds.map((userId) => {
        const answers = new Map(
          step.answers.filter((answer) => answer.userId === userId).map((answer) => [answer.questionId, answer]),
        );
        const document = step.documents.find((link) => link.userId === userId && link.questionId === null);
        return (
          <Accordion.Item key={userId} value={userId}>
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap" pr="xs">
                <Text size="sm" fw={500}>
                  {displayNameFor(members, userId)}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('sessionZero.questions.answered', {
                    count: answers.size,
                    total: step.questions.length,
                  })}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {canEdit ? (
                  <>
                    <Text size="xs" c="dimmed">
                      {t('sessionZero.questions.masterEdits')}
                    </Text>
                    <AnswerFields
                      questions={step.questions}
                      saved={answers}
                      editable
                      privacyEditable={false}
                      save={(changed) =>
                        act(
                          boardWrites.saveAnswersFor(
                            module.id,
                            userId,
                            changed.map(({ questionId, body }) => ({
                              questionId,
                              body,
                            })),
                          ),
                        )
                      }
                    />
                  </>
                ) : (
                  step.questions.map((question) => (
                    <ReadAnswer key={question.id} question={question} answer={answers.get(question.id)} />
                  ))
                )}
                {document && (
                  <Button
                    component={Link}
                    to={`/rooms/${roomId}/documents/${document.documentId}`}
                    size="compact-sm"
                    variant="light"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {t('sessionZero.questions.openDocument')}
                  </Button>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );
}

function ReadAnswer({ question, answer }: { question: Question; answer: Answer | undefined }) {
  const { t } = useTranslation();
  return (
    <Box>
      <Text size="xs" c="dimmed">
        {question.body}
        {answer?.notePrivate && question.target === 'note' && ` · ${t('sessionZero.questions.private')}`}
      </Text>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} c={answer ? undefined : 'dimmed'}>
        {answer?.body ?? '—'}
      </Text>
    </Box>
  );
}

interface LocalAnswer {
  body: string;
  notePrivate: boolean;
}

/**
 * A Player's side: their form, saved as they type (Decision 10), "Create my
 * Document" once the Name question is answered (Decision 11), and everyone's
 * answers once the Master reveals them.
 */
function PlayerQuestions({ roomId, module, step, editable }: StepProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backState = useBackState();
  const { act, busy, members } = useBoard();
  const mine = step.documents.find((link) => link.mine && link.questionId === null);
  const nameQuestion = step.questions.find((question) => question.target === 'name');
  const named = step.answers.some((answer) => answer.mine && answer.questionId === nameQuestion?.id);
  // Spec 70 Decision 12: with no Name question, only standalone "New Document" ones are made.
  const unmadeExtra = step.questions.some(
    (question) =>
      question.target === 'document' &&
      step.answers.some((answer) => answer.mine && answer.questionId === question.id) &&
      !step.documents.some((link) => link.mine && link.questionId === question.id),
  );
  const others = members
    .filter((member) => member.role === 'player')
    .map((member) => member.userId)
    .filter((userId) => step.answers.some((answer) => answer.userId === userId && !answer.mine));

  const create = () =>
    act(boardWrites.createMyDocument(module.id), (next: SessionZero) => {
      const made = next.modules
        .find((candidate) => candidate.id === module.id)
        ?.questions?.documents.find((link) => link.mine && link.questionId === null);
      if (made)
        navigate(`/rooms/${roomId}/documents/${made.documentId}`, {
          state: backState,
        });
    });

  if (step.questions.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t('sessionZero.questions.nonePlayer')}
      </Text>
    );
  }
  return (
    <Stack gap="md">
      <Title order={2} fz="h3">
        {t('sessionZero.questions.title')}
      </Title>
      <AnswerForm module={module} step={step} editable={editable} />
      {!nameQuestion ? (
        step.canCreate && editable ? (
          <Group gap="sm">
            <Button disabled={busy} onClick={() => act(boardWrites.createMyDocument(module.id))}>
              {t('sessionZero.questions.createMineExtras')}
            </Button>
          </Group>
        ) : (
          editable &&
          unmadeExtra && (
            <Text size="sm" c="dimmed">
              {t('sessionZero.questions.masterCreatesExtras')}
            </Text>
          )
        )
      ) : (
        <Group gap="sm">
          {mine ? (
            <Button
              component={Link}
              to={`/rooms/${roomId}/documents/${mine.documentId}`}
              state={backState}
              variant="light"
            >
              {t('sessionZero.questions.openMine')}
            </Button>
          ) : step.canCreate && editable ? (
            <Button disabled={busy} onClick={create}>
              {t('sessionZero.questions.createMine')}
            </Button>
          ) : (
            editable && (
              <Text size="sm" c="dimmed">
                {named ? t('sessionZero.questions.masterCreates') : t('sessionZero.questions.nameFirst')}
              </Text>
            )
          )}
        </Group>
      )}
      {step.answersRevealed && others.length > 0 && (
        <Stack gap="xs">
          <Title order={3} fz="h5">
            {t('sessionZero.questions.everyone')}
          </Title>
          <AnswersByPlayer roomId={roomId} module={module} step={step} userIds={others} />
        </Stack>
      )}
    </Stack>
  );
}

/** The Player's own answers, saved as they type (Decision 10). */
function AnswerForm({ module, step, editable }: Omit<StepProps, 'roomId'>) {
  const { t } = useTranslation();
  const { act } = useBoard();
  const saved = new Map(step.answers.filter((answer) => answer.mine).map((answer) => [answer.questionId, answer]));
  return (
    <Stack gap="sm">
      {editable && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.questions.autosave')}
        </Text>
      )}
      <AnswerFields
        questions={step.questions}
        saved={saved}
        editable={editable}
        privacyEditable
        save={(answers) => act(boardWrites.saveAnswers(module.id, answers))}
      />
    </Stack>
  );
}

/** An answer as the server compares it: spaces collapsed, ends trimmed, and the Private tick. */
function comparable(answer: { body: string; notePrivate: boolean }): string {
  return `${answer.body.split(/\s+/).join(' ').trim()}|${answer.notePrivate}`;
}

function storedText(answer: Answer | undefined): string {
  return answer ? comparable(answer) : comparable({ body: '', notePrivate: false });
}

interface AnswerFieldsProps {
  questions: Question[];
  /** The stored answers, by question id. */
  saved: Map<string, Answer>;
  editable: boolean;
  /** Whether the Private tick of a Note answer can change (the Player's choice only, spec 70 Decision 3). */
  privacyEditable: boolean;
  save: (answers: (LocalAnswer & { questionId: string })[]) => void;
}

/**
 * One field per question; changes are sent once typing pauses, when a field
 * is left, and when the fields go away. What was typed stays on screen
 * while it is being typed or sent; a field nobody is typing in follows the
 * stored answer, so the Master's edits reach the Player's open form (spec 70
 * Decision 6).
 */
function AnswerFields({ questions, saved, editable, privacyEditable, save }: AnswerFieldsProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<Record<string, LocalAnswer>>({});
  const pending = useRef<Record<string, LocalAnswer>>({});
  const focused = useRef<string | null>(null);
  // Fields whose text was sent: what was stored when it was, and what was sent.
  const sent = useRef<Record<string, { before: string; text: string }>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = () => {
    clearTimeout(timer.current);
    const answers = Object.entries(pending.current).map(([questionId, answer]) => ({ questionId, ...answer }));
    pending.current = {};
    if (answers.length === 0) return;
    for (const answer of answers) {
      sent.current[answer.questionId] = { before: storedText(saved.get(answer.questionId)), text: comparable(answer) };
    }
    save(answers);
  };
  // What is still unsent goes when the fields do (another step, another page).
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  });
  useEffect(() => () => latestFlush.current(), []);

  // When the stored answers change, fields nobody is typing in and with
  // nothing left to send show them again. A sent field waits until its own
  // stored answer changes (our save stored, or someone else's edit since):
  // no callback is needed, so a failed or overlapping save never pins it.
  useEffect(() => {
    setLocal((previous) => {
      const kept = Object.fromEntries(
        Object.entries(previous).filter(([questionId]) => {
          if (questionId === focused.current || questionId in pending.current) return true;
          const mark = sent.current[questionId];
          if (mark && storedText(saved.get(questionId)) === mark.before && mark.before !== mark.text) return true;
          delete sent.current[questionId];
          return false;
        }),
      );
      return Object.keys(kept).length === Object.keys(previous).length ? previous : kept;
    });
  }, [saved]);

  const valueOf = (question: Question): LocalAnswer => {
    const stored = saved.get(question.id);
    return (
      local[question.id] ?? {
        body: stored?.body ?? '',
        notePrivate: stored?.notePrivate ?? false,
      }
    );
  };
  const change = (question: Question, value: LocalAnswer, now = false) => {
    setLocal((previous) => ({ ...previous, [question.id]: value }));
    pending.current[question.id] = value;
    clearTimeout(timer.current);
    if (now) flush();
    else timer.current = setTimeout(() => latestFlush.current(), ANSWER_SAVE_DELAY_MS);
  };

  return (
    <Stack gap="sm">
      {questions.map((question) => {
        const value = valueOf(question);
        const field = {
          label: question.body,
          description: question.hint ?? undefined,
          value: value.body,
          readOnly: !editable,
          onFocus: () => {
            focused.current = question.id;
          },
          onBlur: () => {
            focused.current = null;
            flush();
          },
        };
        const where = t(`sessionZero.questions.goesTo.${question.target}`);
        return (
          <Paper key={question.id} withBorder radius="sm" p="sm">
            <Stack gap={4}>
              {question.target === 'name' || question.target === 'subtitle' ? (
                <TextInput
                  {...field}
                  maxLength={question.target === 'name' ? MAX_NAME_ANSWER_LENGTH : MAX_SUBTITLE_ANSWER_LENGTH}
                  onChange={(event) =>
                    change(question, {
                      ...value,
                      body: event.currentTarget.value,
                    })
                  }
                />
              ) : (
                <Textarea
                  {...field}
                  autosize
                  minRows={2}
                  maxLength={MAX_ANSWER_LENGTH}
                  onChange={(event) =>
                    change(question, {
                      ...value,
                      body: event.currentTarget.value,
                    })
                  }
                />
              )}
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed">
                  {where}
                </Text>
                {question.target === 'note' && (
                  <Checkbox
                    size="xs"
                    label={t('sessionZero.questions.private')}
                    checked={value.notePrivate}
                    disabled={!editable || !privacyEditable}
                    onChange={(event) => change(question, { ...value, notePrivate: event.currentTarget.checked }, true)}
                  />
                )}
              </Group>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

interface DraftRow extends QuestionDraft {
  key: number;
}

/** What the editor would save, to tell whether anything changed. */
function draftSignature(rows: DraftRow[]): string {
  return JSON.stringify(rows.map(({ key: _key, ...row }) => row));
}

/**
 * "Edit questions" (Decision 9): the whole list, saved together; a question
 * removed takes its answers with it. The first question added asks for the
 * Name, the next ones for the description. A click outside doesn't close
 * it, and closing with unsaved changes asks first.
 */
function QuestionsEditor({
  module,
  step,
  tags,
  onClose,
}: {
  module: SessionZeroModule;
  step: QuestionsStep;
  tags: Tag[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { act, busy } = useBoard();
  const nextKey = useRef(step.questions.length);
  const [rows, setRows] = useState<DraftRow[]>(() =>
    step.questions.map((question, key) => ({
      key,
      id: question.id,
      body: question.body,
      hint: question.hint ?? '',
      target: question.target,
      tagId: question.tagId,
    })),
  );
  const [initial] = useState(() => draftSignature(rows));
  const [leaving, setLeaving] = useState(false);
  const phone = useMediaQuery('(max-width: 48em)', false, {
    getInitialValueInEffect: false,
  });
  const problem = questionsProblem(rows);
  // Unsaved questions are only dropped once the Master says so.
  const close = () => (draftSignature(rows) === initial ? onClose() : setLeaving(true));
  const update = (key: number, changes: Partial<QuestionDraft>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  const move = (index: number, to: number) =>
    setRows((previous) => {
      const next = previous.filter((_, other) => other !== index);
      next.splice(to, 0, previous[index]);
      return next;
    });
  const add = () => {
    // An empty list starts with the Name question; without one, a new
    // question can't fill a Document (spec 70 Decisions 11 and 14).
    const target = rows.length === 0 ? 'name' : rows.some((row) => row.target === 'name') ? 'description' : 'none';
    setRows([
      ...rows,
      {
        key: nextKey.current++,
        id: null,
        body: '',
        hint: '',
        target,
        tagId: null,
      },
    ]);
  };
  const named = rows.some((row) => row.target === 'name');
  // Without a Name question, Subtitle, Description and Note have no Document to fill (spec 70 Decision 11).
  const targetsFor = (current: QuestionDraft['target']) =>
    QUESTION_TARGETS.map((value) => ({
      value,
      label: t(`sessionZero.questions.targets.${value}`),
      disabled: !named && value !== current && MAIN_DOCUMENT_TARGETS.includes(value),
    }));
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));

  return (
    <Modal
      opened
      onClose={close}
      title={t('sessionZero.questions.edit')}
      size="xl"
      fullScreen={phone}
      closeOnClickOutside={false}
      centered
    >
      <Stack>
        <Text size="xs" c="dimmed">
          {t('sessionZero.questions.editHint')}
        </Text>
        {rows.map((row, index) => (
          <Paper key={row.key} withBorder radius="sm" p="xs">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap={4}>
                <Text size="sm" fw={500}>
                  {t('sessionZero.questions.number', { number: index + 1 })}
                </Text>
                <Group gap={2} wrap="nowrap">
                  <LabeledActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={t('sessionZero.modules.moveUp')}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUpIcon size={16} />
                  </LabeledActionIcon>
                  <LabeledActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={t('sessionZero.modules.moveDown')}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDownIcon size={16} />
                  </LabeledActionIcon>
                  <LabeledActionIcon
                    variant="subtle"
                    color="danger"
                    size="sm"
                    aria-label={t('sessionZero.modules.remove')}
                    onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
                  >
                    <TrashIcon size={16} />
                  </LabeledActionIcon>
                </Group>
              </Group>
              <TextInput
                size="xs"
                label={t('sessionZero.questions.question')}
                value={row.body}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(event) => update(row.key, { body: event.currentTarget.value })}
              />
              <TextInput
                size="xs"
                label={t('sessionZero.questions.hint')}
                value={row.hint}
                maxLength={MAX_HINT_LENGTH}
                onChange={(event) => update(row.key, { hint: event.currentTarget.value })}
              />
              <Group grow gap="xs" align="flex-end">
                <Select
                  size="xs"
                  label={t('sessionZero.questions.target')}
                  allowDeselect={false}
                  data={targetsFor(row.target)}
                  value={row.target}
                  onChange={(value) =>
                    update(row.key, {
                      target: value as QuestionDraft['target'],
                    })
                  }
                />
                {row.target === 'document' && (
                  <Select
                    size="xs"
                    label={t('sessionZero.questions.documentTag')}
                    placeholder={t('sessionZero.questions.noTag')}
                    clearable
                    data={tagOptions}
                    value={row.tagId}
                    onChange={(value) => update(row.key, { tagId: value })}
                  />
                )}
              </Group>
            </Stack>
          </Paper>
        ))}
        <Group justify="space-between">
          <Button
            size="xs"
            variant="default"
            leftSection={<PlusIcon size={16} />}
            disabled={rows.length >= MAX_QUESTIONS}
            onClick={add}
          >
            {t('sessionZero.questions.add')}
          </Button>
          {problem && (
            <Text size="xs" c="red">
              {t(problem, { max: MAX_DOCUMENT_QUESTIONS })}
            </Text>
          )}
        </Group>
        {leaving ? (
          <Group justify="flex-end" gap="sm">
            <Text size="sm" c="dimmed" mr="auto">
              {t('sessionZero.questions.unsaved')}
            </Text>
            <Button variant="subtle" color="gray" onClick={() => setLeaving(false)}>
              {t('sessionZero.questions.keepEditing')}
            </Button>
            <Button color="danger" variant="light" onClick={onClose}>
              {t('sessionZero.questions.discard')}
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || problem !== null}
              onClick={() => act(boardWrites.setQuestions(module.id, rows), onClose)}
            >
              {t('common.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
