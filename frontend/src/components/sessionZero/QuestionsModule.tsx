import { useEffect, useRef, useState } from 'react';
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
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import {
  MAX_ANSWER_LENGTH,
  MAX_DOCUMENT_QUESTIONS,
  MAX_HINT_LENGTH,
  MAX_NAME_ANSWER_LENGTH,
  MAX_QUESTIONS,
  MAX_QUESTION_LENGTH,
  MAX_SUBTITLE_ANSWER_LENGTH,
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
  const { act, busy, members } = useBoard();
  const [editing, setEditing] = useState(false);
  const players = members.filter((member) => member.role === 'player');
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));
  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={2} fz="h4">
            {t('sessionZero.questions.title')}
          </Title>
          {editable && (
            <Button size="compact-sm" variant="default" onClick={() => setEditing(true)}>
              {t('sessionZero.questions.edit')}
            </Button>
          )}
        </Group>
        {editable && (
          <Group align="flex-end" gap="md">
            <Select
              size="xs"
              label={t('sessionZero.questions.tag')}
              placeholder={t('sessionZero.questions.noTag')}
              clearable
              data={tagOptions}
              value={step.tagId}
              disabled={busy}
              onChange={(value) => act(boardWrites.setQuestionsTag(module.id, value))}
            />
            <Switch
              size="sm"
              label={t('sessionZero.questions.bypass')}
              checked={step.playersBypassCreationRule}
              disabled={busy}
              onChange={(event) => act(boardWrites.setCreationBypass(module.id, event.currentTarget.checked))}
            />
          </Group>
        )}
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
                <Button
                  size="compact-sm"
                  disabled={busy || step.creatable === 0}
                  onClick={() => act(boardWrites.createEveryoneDocuments(module.id))}
                >
                  {t('sessionZero.questions.createAll', { count: step.creatable })}
                </Button>
              </Group>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {step.answersRevealed ? t('sessionZero.questions.revealedHint') : t('sessionZero.questions.privateHint')}
          </Text>
          <AnswersByPlayer roomId={roomId} step={step} userIds={players.map((player) => player.userId)} />
        </Stack>
      )}
      {editing && <QuestionsEditor module={module} step={step} tags={tags} onClose={() => setEditing(false)} />}
    </Stack>
  );
}

/** One row per Player: how many questions they answered, their answers and their Document. */
function AnswersByPlayer({ roomId, step, userIds }: { roomId: string; step: QuestionsStep; userIds: string[] }) {
  const { t } = useTranslation();
  const { members } = useBoard();
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
                  {t('sessionZero.questions.answered', { count: answers.size, total: step.questions.length })}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {step.questions.map((question) => (
                  <ReadAnswer key={question.id} question={question} answer={answers.get(question.id)} />
                ))}
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
  const { act, busy, members } = useBoard();
  const mine = step.documents.find((link) => link.mine && link.questionId === null);
  const nameQuestion = step.questions.find((question) => question.target === 'name');
  const named = step.answers.some((answer) => answer.mine && answer.questionId === nameQuestion?.id);
  const others = members
    .filter((member) => member.role === 'player')
    .map((member) => member.userId)
    .filter((userId) => step.answers.some((answer) => answer.userId === userId && !answer.mine));

  const create = () =>
    act(boardWrites.createMyDocument(module.id), (next: SessionZero) => {
      const made = next.modules
        .find((candidate) => candidate.id === module.id)
        ?.questions?.documents.find((link) => link.mine && link.questionId === null);
      if (made) navigate(`/rooms/${roomId}/documents/${made.documentId}`);
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
      <Title order={2} fz="h4">
        {t('sessionZero.questions.title')}
      </Title>
      <AnswerForm module={module} step={step} editable={editable} />
      <Group gap="sm">
        {mine ? (
          <Button component={Link} to={`/rooms/${roomId}/documents/${mine.documentId}`} variant="light">
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
      {step.answersRevealed && others.length > 0 && (
        <Stack gap="xs">
          <Title order={3} fz="h5">
            {t('sessionZero.questions.everyone')}
          </Title>
          <AnswersByPlayer roomId={roomId} step={step} userIds={others} />
        </Stack>
      )}
    </Stack>
  );
}

/**
 * The Player's answers, one field per question; changes are sent once
 * typing pauses, when a field is left, and when the form goes away. What
 * they typed stays on screen whatever the boards answer.
 */
function AnswerForm({ module, step, editable }: Omit<StepProps, 'roomId'>) {
  const { t } = useTranslation();
  const { act } = useBoard();
  const [local, setLocal] = useState<Record<string, LocalAnswer>>({});
  const pending = useRef<Record<string, LocalAnswer>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = () => {
    clearTimeout(timer.current);
    const answers = Object.entries(pending.current).map(([questionId, answer]) => ({ questionId, ...answer }));
    pending.current = {};
    if (answers.length > 0) act(boardWrites.saveAnswers(module.id, answers));
  };
  // What is still unsent goes when the form does (another step, another page).
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  });
  useEffect(() => () => latestFlush.current(), []);

  const valueOf = (question: Question): LocalAnswer => {
    const saved = step.answers.find((answer) => answer.mine && answer.questionId === question.id);
    return local[question.id] ?? { body: saved?.body ?? '', notePrivate: saved?.notePrivate ?? false };
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
      {editable && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.questions.autosave')}
        </Text>
      )}
      {step.questions.map((question) => {
        const value = valueOf(question);
        const field = {
          label: question.body,
          description: question.hint ?? undefined,
          value: value.body,
          readOnly: !editable,
          onBlur: flush,
        };
        const where = t(`sessionZero.questions.goesTo.${question.target}`);
        return (
          <Paper key={question.id} withBorder radius="sm" p="sm">
            <Stack gap={4}>
              {question.target === 'name' || question.target === 'subtitle' ? (
                <TextInput
                  {...field}
                  maxLength={question.target === 'name' ? MAX_NAME_ANSWER_LENGTH : MAX_SUBTITLE_ANSWER_LENGTH}
                  onChange={(event) => change(question, { ...value, body: event.currentTarget.value })}
                />
              ) : (
                <Textarea
                  {...field}
                  autosize
                  minRows={2}
                  maxLength={MAX_ANSWER_LENGTH}
                  onChange={(event) => change(question, { ...value, body: event.currentTarget.value })}
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
                    disabled={!editable}
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

/**
 * "Edit questions" (Decision 9): the whole list, saved together; a question
 * removed takes its answers with it. The first question added asks for the
 * Name, the next ones for the description.
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
  const problem = questionsProblem(rows);
  const update = (key: number, changes: Partial<QuestionDraft>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  const move = (index: number, to: number) =>
    setRows((previous) => {
      const next = previous.filter((_, other) => other !== index);
      next.splice(to, 0, previous[index]);
      return next;
    });
  const add = () => {
    const target = rows.some((row) => row.target === 'name') ? 'description' : 'name';
    setRows([...rows, { key: nextKey.current++, id: null, body: '', hint: '', target, tagId: null }]);
  };
  const targets = QUESTION_TARGETS.map((value) => ({ value, label: t(`sessionZero.questions.targets.${value}`) }));
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));

  return (
    <Modal opened onClose={onClose} title={t('sessionZero.questions.edit')} size="lg" centered>
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
                    <ArrowUpIcon size={14} />
                  </LabeledActionIcon>
                  <LabeledActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={t('sessionZero.modules.moveDown')}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDownIcon size={14} />
                  </LabeledActionIcon>
                  <LabeledActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label={t('sessionZero.modules.remove')}
                    onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
                  >
                    <TrashIcon size={14} />
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
                  data={targets}
                  value={row.target}
                  onChange={(value) => update(row.key, { target: value as QuestionDraft['target'] })}
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
            leftSection={<PlusIcon size={14} />}
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
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || problem !== null} onClick={() => act(boardWrites.setQuestions(module.id, rows), onClose)}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
