import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Radio,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, PlusIcon, TrashIcon, TrophyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { displayNameFor } from '../../lib/members';
import {
  MAX_HINT_LENGTH,
  MAX_POLL_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLLS,
  MIN_POLL_OPTIONS,
  boardWrites,
  pollsProblem,
  type PollDraft,
} from '../../lib/sessionZero';
import type { Poll, PollResults, PollVotersVisible, SessionZeroModule } from '../../types/sessionZero';
import { useBoard } from './boardContext';

/**
 * A Poll step (spec 53): the Master's polls, one under the other. Each
 * shows how many have voted and, when the viewer may see it, the tally and
 * who voted what; a voter votes right here, saved on each change.
 */
export function PollBoard() {
  const { t } = useTranslation();
  const { board, module, writable } = useBoard();
  const polls = module?.polls;
  const [editing, setEditing] = useState(false);
  useEveryoneVotedToast(polls ?? [], board.canManage);
  if (!module || !polls) return null;
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  const editable = open && writable;
  return (
    <Box component="section" aria-label={t('sessionZero.modules.kinds.poll')} className="sz-polls">
      <Stack gap="md">
        <Group gap="md" align="center">
          <Title order={2} fz="h4">
            {t('sessionZero.polls.title')}
          </Title>
          {board.canManage && editable && (
            <Button size="compact-sm" variant="default" ml="auto" onClick={() => setEditing(true)}>
              {t('sessionZero.polls.edit')}
            </Button>
          )}
        </Group>
        {polls.length === 0 ? (
          <Text size="sm" c="dimmed">
            {board.canManage ? t('sessionZero.polls.noneMaster') : t('sessionZero.polls.nonePlayer')}
          </Text>
        ) : (
          polls.map((poll) => <PollCard key={poll.id} poll={poll} editable={editable} />)
        )}
      </Stack>
      {editing && <PollsEditor module={module} polls={polls} onClose={() => setEditing(false)} />}
    </Box>
  );
}

/**
 * Decision 5: a toast for the Master when, live, the last voter of a poll
 * votes. Polls already complete when the page opens say nothing.
 */
function useEveryoneVotedToast(polls: Poll[], master: boolean) {
  const { t } = useTranslation();
  const complete = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    const now = new Map(polls.map((poll) => [poll.id, isComplete(poll)]));
    const before = complete.current;
    complete.current = now;
    if (!before || !master) return;
    for (const poll of polls) {
      if (now.get(poll.id) && before.get(poll.id) === false) {
        notifications.show({
          color: 'var(--state-success)',
          message: t('sessionZero.polls.everyoneVotedToast', { poll: poll.body }),
        });
      }
    }
  }, [polls, master, t]);
}

function isComplete(poll: Poll): boolean {
  return poll.electorate > 0 && poll.voterCount >= poll.electorate;
}

/** One poll: its settings at a glance, the choices (to vote, or with the tally), progress and the Master's actions. */
function PollCard({ poll, editable }: { poll: Poll; editable: boolean }) {
  const { t } = useTranslation();
  const { board, act, busy, members } = useBoard();
  const voting = editable && poll.canVote;
  const left = poll.maxChoices - poll.myOptionIds.length;
  const vote = (optionIds: string[]) => act(boardWrites.vote(poll.id, optionIds));
  const toggle = (optionId: string, checked: boolean) =>
    vote(checked ? [...poll.myOptionIds, optionId] : poll.myOptionIds.filter((id) => id !== optionId));
  const names = (ids: string[]) => ids.map((id) => displayNameFor(members, id)).join(', ');
  return (
    <Paper withBorder radius="md" p="md" className="sz-poll">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" gap="xs">
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              {poll.body}
            </Text>
            {poll.hint && (
              <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                {poll.hint}
              </Text>
            )}
          </Box>
          <Group gap={6}>
            {poll.closed && (
              <Badge variant="light" color="gray">
                {t('sessionZero.polls.closed')}
              </Badge>
            )}
            {poll.results === 'hidden' && (
              <Badge variant="light" color="grape">
                {poll.revealed ? t('sessionZero.polls.revealed') : t('sessionZero.polls.secret')}
              </Badge>
            )}
            {poll.votersVisible === 'nobody' && (
              <Badge variant="light" color="gray">
                {t('sessionZero.polls.anonymous')}
              </Badge>
            )}
            {voting && poll.maxChoices > 1 && (
              <Badge variant="filled" color={left > 0 ? 'blue' : 'gray'}>
                {t('sessionZero.polls.votesLeft', { count: left })}
              </Badge>
            )}
          </Group>
        </Group>

        {voting && poll.maxChoices === 1 ? (
          <Radio.Group
            value={poll.myOptionIds[0] ?? null}
            onChange={(value) => vote([value])}
            aria-label={poll.body}
          >
            <Stack gap={6}>
              {poll.options.map((option) => (
                <OptionRow key={option.id} poll={poll} option={option} names={names}>
                  <Radio value={option.id} label={option.body} disabled={busy} />
                </OptionRow>
              ))}
            </Stack>
          </Radio.Group>
        ) : (
          <Stack gap={6} role={voting ? 'group' : undefined} aria-label={voting ? poll.body : undefined}>
            {poll.options.map((option) => {
              const mine = poll.myOptionIds.includes(option.id);
              return (
                <OptionRow key={option.id} poll={poll} option={option} names={names}>
                  {voting ? (
                    <Checkbox
                      label={option.body}
                      checked={mine}
                      disabled={busy || (!mine && left <= 0)}
                      onChange={(event) => toggle(option.id, event.currentTarget.checked)}
                    />
                  ) : (
                    <Group gap={6} wrap="nowrap">
                      {mine && <CheckCircleIcon size={16} weight="fill" aria-label={t('sessionZero.polls.yourVote')} />}
                      <Text size="sm" fw={option.winner ? 700 : undefined} style={{ overflowWrap: 'anywhere' }}>
                        {option.body}
                      </Text>
                      {option.winner && <TrophyIcon size={16} aria-label={t('sessionZero.polls.winner')} />}
                    </Group>
                  )}
                </OptionRow>
              );
            })}
          </Stack>
        )}

        {voting && poll.myOptionIds.length > 0 && (
          <Button size="compact-xs" variant="subtle" color="gray" w="fit-content" disabled={busy} onClick={() => vote([])}>
            {t('sessionZero.polls.withdraw')}
          </Button>
        )}
        {!poll.tallyVisible && (
          <Text size="xs" c="dimmed">
            {t('sessionZero.polls.secretHint')}
          </Text>
        )}

        <Group justify="space-between" gap="xs">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {t('sessionZero.polls.progress', { count: poll.voterCount, total: poll.electorate })}
            </Text>
            {isComplete(poll) && (
              <Badge variant="light" color="green" leftSection={<CheckCircleIcon size={14} aria-hidden="true" />}>
                {t('sessionZero.polls.everyoneVoted')}
              </Badge>
            )}
          </Group>
          {board.canManage && editable && (
            <Group gap="xs">
              {poll.results === 'hidden' && (
                <Button
                  size="compact-sm"
                  variant="default"
                  disabled={busy}
                  onClick={() => act(boardWrites.revealPoll(poll.id, !poll.revealed))}
                >
                  {poll.revealed ? t('sessionZero.polls.hide') : t('sessionZero.polls.reveal')}
                </Button>
              )}
              <Button
                size="compact-sm"
                variant={poll.closed ? 'default' : 'light'}
                disabled={busy}
                onClick={() => act(boardWrites.closePoll(poll.id, !poll.closed))}
              >
                {poll.closed ? t('sessionZero.polls.reopen') : t('sessionZero.polls.close')}
              </Button>
            </Group>
          )}
        </Group>
        {poll.notVoted && poll.notVoted.length > 0 && (
          <Text size="xs" c="dimmed">
            {t('sessionZero.polls.notVoted', { names: names(poll.notVoted) })}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** A choice with, when the viewer sees it, its count, a bar and (on hover) who voted for it. */
function OptionRow({
  poll,
  option,
  names,
  children,
}: {
  poll: Poll;
  option: Poll['options'][number];
  names: (ids: string[]) => string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const count = option.count;
  return (
    <Box className={option.winner ? 'sz-poll-option sz-poll-winner' : 'sz-poll-option'}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
        {count !== null && (
          <Tooltip
            label={option.voters && option.voters.length > 0 ? names(option.voters) : t('sessionZero.polls.noVotes')}
            disabled={option.voters === null}
            withArrow
            events={{ hover: true, focus: true, touch: true }}
          >
            <Text size="sm" fw={600} tabIndex={option.voters === null ? undefined : 0}>
              {t('sessionZero.polls.votes', { count })}
            </Text>
          </Tooltip>
        )}
      </Group>
      {count !== null && (
        <Progress
          mt={4}
          size="sm"
          value={poll.voterCount > 0 ? (count / poll.voterCount) * 100 : 0}
          color={option.winner ? 'green' : 'blue'}
          aria-hidden="true"
        />
      )}
    </Box>
  );
}

interface DraftRow extends PollDraft {
  key: number;
  locked: boolean;
}

function draftSignature(rows: DraftRow[]): string {
  return JSON.stringify(rows.map(({ key: _key, locked: _locked, ...row }) => row));
}

function blankPoll(key: number): DraftRow {
  return {
    key,
    locked: false,
    id: null,
    body: '',
    hint: '',
    maxChoices: 1,
    masterVotes: false,
    votersVisible: 'master',
    results: 'live',
    options: [
      { id: null, body: '' },
      { id: null, body: '' },
    ],
  };
}

/**
 * "Edit polls" (Decisions 2 and 3): every poll and its choices, saved
 * together; a poll or choice removed takes its votes with it, and a poll's
 * settings are locked once it has votes. A click outside doesn't close it,
 * and closing with unsaved changes asks first.
 */
function PollsEditor({ module, polls, onClose }: { module: SessionZeroModule; polls: Poll[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { act, busy } = useBoard();
  const nextKey = useRef(polls.length);
  const [rows, setRows] = useState<DraftRow[]>(() =>
    polls.map((poll, key) => ({
      key,
      locked: poll.hasVotes,
      id: poll.id,
      body: poll.body,
      hint: poll.hint ?? '',
      maxChoices: poll.maxChoices,
      masterVotes: poll.masterVotes,
      votersVisible: poll.votersVisible,
      results: poll.results,
      options: poll.options.map((option) => ({ id: option.id, body: option.body })),
    })),
  );
  const [initial] = useState(() => draftSignature(rows));
  const [leaving, setLeaving] = useState(false);
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const problem = pollsProblem(rows);
  const close = () => (draftSignature(rows) === initial ? onClose() : setLeaving(true));
  const update = (key: number, changes: Partial<PollDraft>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  const move = (index: number, to: number) =>
    setRows((previous) => {
      const next = previous.filter((_, other) => other !== index);
      next.splice(to, 0, previous[index]);
      return next;
    });
  const visibility: { value: PollVotersVisible; label: string }[] = (['master', 'everyone', 'nobody'] as const).map(
    (value) => ({ value, label: t(`sessionZero.polls.visibility.${value}`) }),
  );
  const results: { value: PollResults; label: string }[] = (['live', 'hidden'] as const).map((value) => ({
    value,
    label: t(`sessionZero.polls.results.${value}`),
  }));

  return (
    <Modal
      opened
      onClose={close}
      title={t('sessionZero.polls.edit')}
      size="xl"
      fullScreen={phone}
      closeOnClickOutside={false}
      centered
    >
      <Stack>
        <Text size="xs" c="dimmed">
          {t('sessionZero.polls.editHint')}
        </Text>
        {rows.map((row, index) => (
          <Paper key={row.key} withBorder radius="sm" p="xs">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap={4}>
                <Text size="sm" fw={500}>
                  {t('sessionZero.polls.number', { number: index + 1 })}
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
                    color="red"
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
                label={t('sessionZero.polls.question')}
                value={row.body}
                maxLength={MAX_POLL_LENGTH}
                onChange={(event) => update(row.key, { body: event.currentTarget.value })}
              />
              <TextInput
                size="xs"
                label={t('sessionZero.polls.hint')}
                value={row.hint}
                maxLength={MAX_HINT_LENGTH}
                onChange={(event) => update(row.key, { hint: event.currentTarget.value })}
              />
              <Text size="xs" fw={500}>
                {t('sessionZero.polls.choices')}
              </Text>
              {row.options.map((option, optionIndex) => (
                <Group key={optionIndex} gap={4} wrap="nowrap">
                  <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    aria-label={t('sessionZero.polls.choice', { number: optionIndex + 1 })}
                    placeholder={t('sessionZero.polls.choice', { number: optionIndex + 1 })}
                    value={option.body}
                    maxLength={MAX_POLL_OPTION_LENGTH}
                    onChange={(event) => {
                      const body = event.currentTarget.value;
                      update(row.key, {
                        options: row.options.map((other, at) => (at === optionIndex ? { ...other, body } : other)),
                      });
                    }}
                  />
                  <LabeledActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label={t('sessionZero.polls.removeChoice', { number: optionIndex + 1 })}
                    disabled={row.options.length <= MIN_POLL_OPTIONS}
                    onClick={() => {
                      const options = row.options.filter((_, at) => at !== optionIndex);
                      update(row.key, { options, maxChoices: Math.min(row.maxChoices, options.length) });
                    }}
                  >
                    <TrashIcon size={16} />
                  </LabeledActionIcon>
                </Group>
              ))}
              <Button
                size="compact-xs"
                variant="subtle"
                w="fit-content"
                leftSection={<PlusIcon size={14} />}
                disabled={row.options.length >= MAX_POLL_OPTIONS}
                onClick={() => update(row.key, { options: [...row.options, { id: null, body: '' }] })}
              >
                {t('sessionZero.polls.addChoice')}
              </Button>
              <Group grow gap="xs" align="flex-end">
                <NumberInput
                  size="xs"
                  label={t('sessionZero.polls.maxChoices')}
                  min={1}
                  max={row.options.length}
                  clampBehavior="strict"
                  allowDecimal={false}
                  value={row.maxChoices}
                  disabled={row.locked}
                  onChange={(value) => update(row.key, { maxChoices: typeof value === 'number' ? value : 1 })}
                />
                <Select
                  size="xs"
                  label={t('sessionZero.polls.votersVisible')}
                  allowDeselect={false}
                  data={visibility}
                  value={row.votersVisible}
                  disabled={row.locked}
                  onChange={(value) => update(row.key, { votersVisible: value as PollVotersVisible })}
                />
                <Select
                  size="xs"
                  label={t('sessionZero.polls.resultsLabel')}
                  allowDeselect={false}
                  data={results}
                  value={row.results}
                  disabled={row.locked}
                  onChange={(value) => update(row.key, { results: value as PollResults })}
                />
              </Group>
              <Switch
                size="sm"
                label={t('sessionZero.polls.masterVotes')}
                checked={row.masterVotes}
                disabled={row.locked}
                onChange={(event) => update(row.key, { masterVotes: event.currentTarget.checked })}
              />
              {row.locked && (
                <Text size="xs" c="dimmed">
                  {t('sessionZero.polls.locked')}
                </Text>
              )}
            </Stack>
          </Paper>
        ))}
        <Group justify="space-between">
          <Button
            size="xs"
            variant="default"
            leftSection={<PlusIcon size={16} />}
            disabled={rows.length >= MAX_POLLS}
            onClick={() => setRows([...rows, blankPoll(nextKey.current++)])}
          >
            {t('sessionZero.polls.add')}
          </Button>
          {problem && (
            <Text size="xs" c="red">
              {t(problem, { min: MIN_POLL_OPTIONS, max: MAX_POLL_OPTIONS })}
            </Text>
          )}
        </Group>
        {leaving ? (
          <Group justify="flex-end" gap="sm">
            <Text size="sm" c="dimmed" mr="auto">
              {t('sessionZero.questions.unsaved')}
            </Text>
            <Button variant="default" onClick={() => setLeaving(false)}>
              {t('sessionZero.questions.keepEditing')}
            </Button>
            <Button color="red" variant="light" onClick={onClose}>
              {t('sessionZero.questions.discard')}
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy || problem !== null} onClick={() => act(boardWrites.setPolls(module.id, rows), onClose)}>
              {t('common.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
