import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
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
import { MarkdownText } from '../mentions/MarkdownText';
import { MentionTextarea } from '../mentions/MentionTextarea';
import { displayNameFor } from '../../lib/members';
import {
  MAX_HINT_LENGTH,
  MAX_POLL_LENGTH,
  MAX_POLL_DESCRIPTION_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLLS,
  MIN_POLL_OPTIONS,
  boardWrites,
  pollShares,
  pollShowsResults,
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

/**
 * One poll: its settings at a glance, the choices as a column of cards (to
 * vote, with the tally on their left edge, spec 54), progress and the
 * Master's actions. Once the poll shows its results the cards turn over to
 * their title and share; "Show the options" turns them back for the viewer.
 */
function PollCard({ poll, editable }: { poll: Poll; editable: boolean }) {
  const { t } = useTranslation();
  const { board, act, busy, members } = useBoard();
  const voting = editable && poll.canVote;
  const left = poll.maxChoices - poll.myOptionIds.length;
  const vote = (optionIds: string[]) => act(boardWrites.vote(poll.id, optionIds));
  const toggle = (optionId: string, checked: boolean) =>
    vote(checked ? [...poll.myOptionIds, optionId] : poll.myOptionIds.filter((id) => id !== optionId));
  const names = (ids: string[]) => ids.map((id) => displayNameFor(members, id)).join(', ');
  const results = pollShowsResults(poll) && poll.tallyVisible;
  // "Show the options" lasts until the poll's results state changes.
  const resultsKey = `${poll.closed}-${poll.revealed}`;
  const [peekedAt, setPeekedAt] = useState<string | null>(null);
  const peeking = results && peekedAt === resultsKey;
  const flipped = results && !peeking;
  const shares = pollShares(poll);
  const ready = useMounted();
  const single = poll.maxChoices === 1;
  const cards = (
    <Stack gap="sm" className="sz-poll-cards" data-ready={ready || undefined}>
      {poll.options.map((option, index) => (
        <OptionCard
          key={option.id}
          poll={poll}
          option={option}
          index={index}
          share={shares.get(option.id) ?? null}
          flipped={flipped}
          voting={voting}
          single={single}
          disabled={busy || (!single && !poll.myOptionIds.includes(option.id) && left <= 0)}
          onToggle={(checked) => (single ? vote([option.id]) : toggle(option.id, checked))}
        />
      ))}
    </Stack>
  );
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

        {/* Not keyed on `flipped`: a different wrapper would remount the cards and skip the flip. */}
        {voting && single ? (
          <Radio.Group value={poll.myOptionIds[0] ?? null} onChange={(value) => vote([value])} aria-label={poll.body}>
            {cards}
          </Radio.Group>
        ) : (
          <Box role={voting ? 'group' : undefined} aria-label={voting ? poll.body : undefined}>
            {cards}
          </Box>
        )}

        <Group gap="xs">
          {results && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              w="fit-content"
              onClick={() => setPeekedAt(peeking ? null : resultsKey)}
            >
              {peeking ? t('sessionZero.polls.showResults') : t('sessionZero.polls.showOptions')}
            </Button>
          )}
          {voting && !flipped && poll.myOptionIds.length > 0 && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              w="fit-content"
              disabled={busy}
              onClick={() => vote([])}
            >
              {t('sessionZero.polls.withdraw')}
            </Button>
          )}
        </Group>
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

/** Whether the component has mounted, so changes after that animate (spec 54 Decision 10). */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted;
}

/**
 * A choice as a card (spec 54): the front holds the title, the description
 * and, for a voter, the radio or checkbox (a click anywhere on the card but a
 * link ticks it); the back only the title and the share. The left edge fills
 * to the share whenever the viewer sees the tally.
 */
function OptionCard({
  poll,
  option,
  index,
  share,
  flipped,
  voting,
  single,
  disabled,
  onToggle,
}: {
  poll: Poll;
  option: Poll['options'][number];
  index: number;
  share: number | null;
  flipped: boolean;
  voting: boolean;
  single: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const mine = poll.myOptionIds.includes(option.id);
  const winner = flipped && option.winner;
  const style = { '--share': `${share ?? 0}%`, '--flip-delay': `${index * 80}ms` } as CSSProperties;
  const tick = (event: MouseEvent<HTMLDivElement>) => {
    // The front is hidden once flipped, so a click here is always on choices face up.
    if (!voting || disabled || (single && mine)) return;
    if ((event.target as HTMLElement).closest('a, input, label, button')) return;
    onToggle(!mine);
  };
  const control = voting ? (
    single ? (
      <Radio value={option.id} aria-labelledby={titleId} disabled={disabled} tabIndex={flipped ? -1 : undefined} />
    ) : (
      <Checkbox
        aria-labelledby={titleId}
        checked={mine}
        disabled={disabled}
        tabIndex={flipped ? -1 : undefined}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
    )
  ) : mine && !flipped ? (
    <CheckCircleIcon size={18} weight="fill" aria-label={t('sessionZero.polls.yourVote')} />
  ) : null;

  return (
    <Box
      className="sz-poll-card"
      style={style}
      data-tally={share !== null || undefined}
      data-flipped={flipped || undefined}
      data-winner={winner || undefined}
      data-mine={(voting && mine) || undefined}
    >
      <div className="sz-poll-card-inner">
        <Box
          className="sz-poll-face sz-poll-front"
          aria-hidden={flipped || undefined}
          data-voting={(voting && !flipped) || undefined}
          data-disabled={(voting && disabled && !mine) || undefined}
          onClick={tick}
        >
          <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
            <Group gap="sm" wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
              {control && <Box pt={2}>{control}</Box>}
              <Text id={titleId} fw={600} style={{ overflowWrap: 'anywhere' }}>
                {option.body}
              </Text>
            </Group>
            {option.count !== null && !flipped && <VoteCount option={option} count={option.count} />}
          </Group>
          {option.description && (
            <div className="sz-poll-description">
              <div>
                <MarkdownText text={option.description} mt={6} fz="sm" style={{ overflowWrap: 'anywhere' }} />
              </div>
            </div>
          )}
        </Box>
        <Box className="sz-poll-face sz-poll-back" aria-hidden={!flipped || undefined}>
          <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
            <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              {mine && flipped && (
                <CheckCircleIcon size={18} weight="fill" aria-label={t('sessionZero.polls.yourVote')} />
              )}
              <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                {option.body}
              </Text>
              {winner && <TrophyIcon size={18} aria-label={t('sessionZero.polls.winner')} />}
            </Group>
            <Stack gap={2} align="flex-end">
              <Text
                component="span"
                className="sz-poll-share"
                aria-label={t('sessionZero.polls.share', { share: share ?? 0 })}
              >
                {share ?? 0}%
              </Text>
              {option.count !== null && flipped && <VoteCount option={option} count={option.count} />}
            </Stack>
          </Group>
        </Box>
      </div>
    </Box>
  );
}

/** A choice's vote count with, when the viewer may see them, who gave those votes on hover or tap. */
function VoteCount({ option, count }: { option: Poll['options'][number]; count: number }) {
  const { t } = useTranslation();
  const { members } = useBoard();
  return (
    <Tooltip
      label={
        option.voters && option.voters.length > 0
          ? option.voters.map((id) => displayNameFor(members, id)).join(', ')
          : t('sessionZero.polls.noVotes')
      }
      disabled={option.voters === null}
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <Text size="sm" fw={600} c="dimmed" style={{ whiteSpace: 'nowrap' }} tabIndex={option.voters === null ? undefined : 0}>
        {t('sessionZero.polls.votes', { count })}
      </Text>
    </Tooltip>
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
      { id: null, body: '', description: '' },
      { id: null, body: '', description: '' },
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
      options: poll.options.map((option) => ({
        id: option.id,
        body: option.body,
        description: option.description ?? '',
      })),
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
              {row.options.map((option, optionIndex) => {
                const change = (changes: Partial<PollDraft['options'][number]>) =>
                  update(row.key, {
                    options: row.options.map((other, at) => (at === optionIndex ? { ...other, ...changes } : other)),
                  });
                return (
                  <Stack key={optionIndex} gap={4}>
                    <Group gap={4} wrap="nowrap">
                      <TextInput
                        size="xs"
                        style={{ flex: 1 }}
                        aria-label={t('sessionZero.polls.choice', { number: optionIndex + 1 })}
                        placeholder={t('sessionZero.polls.choice', { number: optionIndex + 1 })}
                        value={option.body}
                        maxLength={MAX_POLL_OPTION_LENGTH}
                        onChange={(event) => change({ body: event.currentTarget.value })}
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
                    <MentionTextarea
                      size="xs"
                      markdown
                      autosize
                      minRows={1}
                      maxRows={8}
                      aria-label={t('sessionZero.polls.choiceDescription', { number: optionIndex + 1 })}
                      placeholder={t('sessionZero.polls.choiceDescription', { number: optionIndex + 1 })}
                      value={option.description}
                      maxLength={MAX_POLL_DESCRIPTION_LENGTH}
                      onChange={(description) => change({ description })}
                    />
                  </Stack>
                );
              })}
              <Button
                size="compact-xs"
                variant="subtle"
                w="fit-content"
                leftSection={<PlusIcon size={14} />}
                disabled={row.options.length >= MAX_POLL_OPTIONS}
                onClick={() => update(row.key, { options: [...row.options, { id: null, body: '', description: '' }] })}
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
