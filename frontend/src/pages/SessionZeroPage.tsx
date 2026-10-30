import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMembers } from '../hooks/useMembers';
import { useTags } from '../hooks/useTags';
import { useSessionZero, useSessionZeroWrite } from '../hooks/useSessionZero';
import { useSessionZeroEvents } from '../hooks/useSessionZeroEvents';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { LinesVeilsColumn, RetroBoard } from '../components/sessionZero/BoardColumns';
import { BoardContext, useBoard, type BoardContextValue } from '../components/sessionZero/boardContext';
import { BoardDnd } from '../components/sessionZero/BoardDnd';
import { BoardsSplit } from '../components/sessionZero/BoardsSplit';
import { ModuleStepper, StartSessionZero } from '../components/sessionZero/ModuleChain';
import { DdiBoard } from '../components/sessionZero/DdiModule';
import { PollBoard } from '../components/sessionZero/PollModule';
import { QuestionsBoard } from '../components/sessionZero/QuestionsModule';
import { SessionZeroHeader } from '../components/sessionZero/SessionZeroHeader';
import { boardWrites, shownModule, viewOf, withView } from '../lib/sessionZero';
import { notifyError } from '../lib/notify';

/** Wide enough for the Retro board beside Lines & Veils; narrower, two tabs (Decision 13). */
const BOARDS_SIDE_BY_SIDE_QUERY = '(min-width: 62em)';

/**
 * `/rooms/:roomId/session-zero`: the Room's Session 0 (spec 46), each
 * session a chain of steps (spec 47): a Retro board with Lines & Veils
 * beside it, Lines & Veils alone, Stars and Wishes, Questions, or a DDI; the shared timer on
 * the title line (spec 46c Decision 2).
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
  // A step this viewer opened (spec 47 Decision 5), while the table stays
  // where it was: once the Master moves it, every page follows.
  const [viewed, setViewed] = useState<{ id: string; current: string | null } | null>(null);
  const board = useSessionZero(roomId, roundId);
  const members = useMembers(roomId, true);
  const tags = useTags(roomId, true);
  const write = useSessionZeroWrite(roomId);
  const writable = !useReadOnly();
  const wide = useMediaQuery(BOARDS_SIDE_BY_SIDE_QUERY, true);
  // A deleted Session 0 (spec 46c Decision 3) has no closed round left to show.
  const glowing = useSessionZeroEvents(roomId, () => setRoundId(null));

  const pickRound = (id: string | null) => {
    setViewed(null);
    setRoundId(id);
  };
  const shown =
    board.data && shownModule(board.data, viewed?.current === board.data.currentModuleId ? viewed.id : null);

  const context: BoardContextValue | null = board.data
    ? {
        board: viewOf(board.data, shown),
        module: shown,
        members: members.data ?? [],
        act: (request, onDone, preview) =>
          write.mutate(
            { write: request, preview: withView(preview, shown?.id) },
            {
              onError: notifyError,
              onSuccess: (next) => {
                // A deleted Session 0 (spec 46c Decision 3) has no rounds left to show.
                if (!next.started) setRoundId(null);
                onDone?.(next);
              },
            },
          ),
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
            <StartSessionZero
              canManage={context.board.canManage}
              busy={write.isPending}
              onStart={(modules) => context.act(boardWrites.start(modules))}
            />
          )}
        </Stack>
      )}
      {context?.board.started && (
        <BoardContext.Provider value={context}>
          <SessionZeroHeader readAtMs={board.dataUpdatedAt} onPick={pickRound} />
          <ModuleStepper
            onView={(id) => setViewed(id === null ? null : { id, current: context.board.currentModuleId })}
          />
          <BoardDnd>
            {shown?.kind === 'ddi' ? (
              <DdiBoard roomId={roomId} />
            ) : shown?.kind === 'poll' ? (
              <PollBoard />
            ) : shown?.kind === 'questions' ? (
              <QuestionsBoard roomId={roomId} tags={tags.data ?? []} />
            ) : shown?.kind === 'lines_veils' ? (
              <LinesVeilsBoard />
            ) : shown?.kind === 'stars_wishes' ? (
              <RetroBoard />
            ) : wide ? (
              <BoardsSplit left={<RetroBoard />} right={<LinesVeilsBoard />} />
            ) : (
              <Tabs defaultValue="retro" keepMounted={false}>
                <Tabs.List mb="sm" grow>
                  <Tabs.Tab value="retro">{t('sessionZero.retro.title')}</Tabs.Tab>
                  <Tabs.Tab value="linesVeils">{t('sessionZero.linesVeils.title')}</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="retro">
                  <RetroBoard />
                </Tabs.Panel>
                <Tabs.Panel value="linesVeils">
                  <LinesVeilsBoard />
                </Tabs.Panel>
              </Tabs>
            )}
          </BoardDnd>
        </BoardContext.Provider>
      )}
    </PageLayout>
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
    <Box component="section" aria-label={t('sessionZero.linesVeils.title')} className="sz-lines-veils">
      {board.linesVeils.map((column) => (
        <LinesVeilsColumn key={column.id} column={column} />
      ))}
    </Box>
  );
}
