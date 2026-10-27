import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Button, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useMediaQuery } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMembers } from '../hooks/useMembers';
import { useSessionZero, useSessionZeroWrite } from '../hooks/useSessionZero';
import { useSessionZeroEvents } from '../hooks/useSessionZeroEvents';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { AddColumn, LinesVeilsColumn, RetroColumn } from '../components/sessionZero/BoardColumns';
import { BoardContext, useBoard, type BoardContextValue } from '../components/sessionZero/boardContext';
import { BoardsSplit } from '../components/sessionZero/BoardsSplit';
import { PublishModal } from '../components/sessionZero/PostItCard';
import { RoundsBar } from '../components/sessionZero/RoundsBar';
import { SessionZeroTitle } from '../components/sessionZero/SessionZeroTitle';
import { MAX_CARDS_PER_BOARD, MAX_RETRO_COLUMNS, boardWrites } from '../lib/sessionZero';
import { notifyError } from '../lib/notify';

/** Wide enough for the Retro board beside Lines & Veils; narrower, two tabs (Decision 13). */
const BOARDS_SIDE_BY_SIDE_QUERY = '(min-width: 62em)';

/**
 * `/rooms/:roomId/session-zero`: the Room's Session 0 (spec 46), its Retro
 * board and its Lines & Veils board, with the shared timer on the title line
 * (spec 46c Decision 2).
 */
export function SessionZeroPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading } = useSession();

  if (!roomId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('sessionZero.signInRequired')}</SignInRequired>;
  return <SessionZeroContent roomId={roomId} />;
}

function SessionZeroContent({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  // The round on the Retro board: null is the open one.
  const [roundId, setRoundId] = useState<string | null>(null);
  const board = useSessionZero(roomId, roundId);
  const members = useMembers(roomId, true);
  const write = useSessionZeroWrite(roomId);
  const writable = !useReadOnly();
  const wide = useMediaQuery(BOARDS_SIDE_BY_SIDE_QUERY, true);
  // A deleted Session 0 (spec 46c Decision 3) has no closed round left to show.
  const glowing = useSessionZeroEvents(roomId, () => setRoundId(null));

  const context: BoardContextValue | null = board.data
    ? {
        board: board.data,
        members: members.data ?? [],
        act: (request, onDone) =>
          write.mutate(request, {
            onError: notifyError,
            onSuccess: (next) => {
              // A deleted Session 0 (spec 46c Decision 3) has no rounds left to show.
              if (!next.started) setRoundId(null);
              onDone?.();
            },
          }),
        busy: write.isPending,
        writable,
        glowing,
      }
    : null;

  return (
    <PageLayout backTo={`/rooms/${roomId}/documents`} backLabel={t('maps.backToDocuments')} roomId={roomId}>
      {!context?.board.started && (
        <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
          {t('sessionZero.title')}
        </Title>
      )}
      {board.isPending && <Loader />}
      {board.isError && <Text c="red">{t('sessionZero.loadError')}</Text>}
      {context && !context.board.started && (
        <Stack gap="sm" align="flex-start">
          <Text c="dimmed">{t('sessionZero.notStarted')}</Text>
          {writable && (
            <Button
              disabled={write.isPending}
              onClick={() => context.act(boardWrites.start())}
            >
              {t('sessionZero.start')}
            </Button>
          )}
        </Stack>
      )}
      {context?.board.started && (
        <BoardContext.Provider value={context}>
          <SessionZeroTitle readAtMs={board.dataUpdatedAt} />
          {wide ? (
            <BoardsSplit left={<RetroBoard onPick={setRoundId} />} right={<LinesVeilsBoard />} />
          ) : (
            <Tabs defaultValue="retro" keepMounted={false}>
              <Tabs.List mb="sm" grow>
                <Tabs.Tab value="retro">{t('sessionZero.retro.title')}</Tabs.Tab>
                <Tabs.Tab value="linesVeils">{t('sessionZero.linesVeils.title')}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="retro">
                <RetroBoard onPick={setRoundId} />
              </Tabs.Panel>
              <Tabs.Panel value="linesVeils">
                <LinesVeilsBoard />
              </Tabs.Panel>
            </Tabs>
          )}
        </BoardContext.Provider>
      )}
    </PageLayout>
  );
}

/** The Retro board of the round picked, its columns side by side, scrolling sideways. */
function RetroBoard({ onPick }: { onPick: (roundId: string | null) => void }) {
  const { t } = useTranslation();
  const { board, writable } = useBoard();
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  return (
    <Stack gap="xs" component="section" aria-label={t('sessionZero.retro.title')}>
      <Title order={2} fz="h4">
        {t('sessionZero.retro.title')}
      </Title>
      <RoundsBar onPick={onPick} />
      {writable && open && <PublishAll />}
      <Box className="sz-retro-scroll" style={{ overflowX: 'auto' }} pb="xs">
        <Group align="flex-start" wrap="nowrap" gap="sm">
          {board.retro.map((column, index) => (
            <RetroColumn key={column.id} column={column} index={index} count={board.retro.length} open={open} />
          ))}
          {writable && open && board.canManage && board.retro.length < MAX_RETRO_COLUMNS && <AddColumn />}
        </Group>
      </Box>
    </Stack>
  );
}

/**
 * "Publish all drafts (N)" above the Retro board while the viewer has drafts
 * in the open round (spec 46c Decision 8): one dialog, one signed or
 * anonymous choice for all of them. Drafts past the board's limit stay
 * drafts, and the dialog says how many.
 */
function PublishAll() {
  const { t } = useTranslation();
  const { board, act, busy } = useBoard();
  const [asking, setAsking] = useState(false);
  const cards = board.retro.flatMap((column) => column.cards);
  const drafts = cards.filter((card) => card.canPublish).length;
  if (drafts === 0) return null;
  const room = MAX_CARDS_PER_BOARD - cards.filter((card) => !card.draft).length;
  const staying = Math.max(0, drafts - Math.max(0, room));
  return (
    <>
      <Button
        size="compact-sm"
        leftSection={<PaperPlaneTiltIcon size={14} />}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setAsking(true)}
      >
        {t('sessionZero.publishAll.button', { count: drafts })}
      </Button>
      {asking && (
        <PublishModal
          title={t('sessionZero.publishAll.title')}
          body={
            <>
              {t('sessionZero.publishAll.body', { count: drafts })}
              {staying > 0 && ` ${t('sessionZero.publishAll.overLimit', { count: staying })}`}
            </>
          }
          busy={busy}
          onClose={() => setAsking(false)}
          onPublish={(anonymous) => act(boardWrites.publishAll(anonymous), () => setAsking(false))}
        />
      )}
    </>
  );
}

/**
 * The Room's one Lines & Veils board: Must, Veils and Lines, whatever the
 * round, as rows one under the other, against the Retro board's columns
 * (spec 46c Decision 11, `.sz-lines-veils`).
 */
function LinesVeilsBoard() {
  const { t } = useTranslation();
  const { board } = useBoard();
  return (
    <Stack gap="xs" component="section" aria-label={t('sessionZero.linesVeils.title')}>
      <Title order={2} fz="h4">
        {t('sessionZero.linesVeils.title')}
      </Title>
      <div className="sz-lines-veils">
        {board.linesVeils.map((column) => (
          <LinesVeilsColumn key={column.id} column={column} />
        ))}
      </div>
    </Stack>
  );
}
