import { useEffect, useState, type ReactNode } from 'react';
import { ActionIcon, Badge, Box, Button, Collapse, Group, Loader, Stack, Text } from '@mantine/core';
import { CaretDownIcon, CaretRightIcon, EyeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { BlockHeading } from './BlockHeading';
import { BoardDnd } from '../sessionZero/BoardDnd';
import { RetroBoard } from '../sessionZero/BoardColumns';
import { DdiBoard } from '../sessionZero/DdiModule';
import { PollBoard } from '../sessionZero/PollModule';
import { QuestionsBoard } from '../sessionZero/QuestionsModule';
import { BoardContext, type BoardContextValue } from '../sessionZero/boardContext';
import { useSetToolVisible, useToolWrite, type SectionTool } from '../../hooks/useLanding';
import { useMembers } from '../../hooks/useMembers';
import { useTags } from '../../hooks/useTags';
import { useReadOnly } from '../../hooks/useViewAs';
import { REVEAL_BLOCK_EVENT, blockAnchor } from '../../lib/landing';
import { notifyError } from '../../lib/notify';
import { toolBoard, viewOf } from '../../lib/sessionZero';
import type { LandingBlock } from '../../types/landing';

const NOTHING: ReadonlySet<string> = new Set();

interface ToolBlockProps {
  roomId: string;
  sectionId: string;
  block: LandingBlock;
  heading: string;
  /** The tool's step; undefined while the tools load (or when a Player can't see it). */
  tool: SectionTool | undefined;
  revision: number;
  loading: boolean;
  isMaster: boolean;
  /** Edit mode's block bar, in place of the heading. */
  bar?: ReactNode;
}

/**
 * A tool block (spec 60 Decisions 1-4): a Session 0 step of the Section's
 * own, drawn inline with the Session 0 page's step components and written
 * through its routes. For the Master a hidden tool shows "Bozza" and a
 * one-click "Mostra ai giocatori"; the Players see it once shown.
 */
export function ToolBlock({ roomId, sectionId, block, heading, tool, revision, loading, isMaster, bar }: ToolBlockProps) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const members = useMembers(roomId, true);
  const tags = useTags(roomId, block.toolKind === 'questions');
  const write = useToolWrite(roomId, sectionId);
  const setVisible = useSetToolVisible(roomId, sectionId);
  const [expanded, setExpanded] = useState(!block.collapsed);
  useEffect(() => {
    const reveal = (event: Event) => {
      if ((event as CustomEvent<string>).detail === block.id) setExpanded(true);
    };
    window.addEventListener(REVEAL_BLOCK_EVENT, reveal);
    return () => window.removeEventListener(REVEAL_BLOCK_EVENT, reveal);
  }, [block.id]);
  if (!isMaster && !tool && !loading) return null;

  const hidden = block.playersVisible === false;
  const show = () =>
    block.moduleId && setVisible.mutate({ moduleId: block.moduleId, visible: true }, { onError: notifyError });
  const draft = isMaster && hidden && (
    <Group gap="xs" wrap="nowrap">
      <Badge variant="light" color="gray" title={t('roomLanding.tool.draftHint')}>
        {t('roomLanding.tool.draft')}
      </Badge>
      {!bar && !readOnly && (
        <Button size="compact-sm" variant="light" leftSection={<EyeIcon size={14} />} loading={setVisible.isPending} onClick={show}>
          {t('roomLanding.tool.show')}
        </Button>
      )}
    </Group>
  );

  let body: ReactNode;
  if (!tool) {
    body = loading ? <Loader size="sm" color="accent" /> : <Text c="red" size="sm">{t('roomLanding.tool.loadError')}</Text>;
  } else {
    const board = toolBoard(tool.module, revision, isMaster);
    const module = board.modules[0];
    const context: BoardContextValue = {
      board: viewOf(board, module),
      module,
      members: members.data ?? [],
      act: (request, onDone) =>
        write.mutate(request, { onError: notifyError, onSuccess: () => onDone?.(board) }),
      busy: write.isPending,
      writable: !readOnly,
      glowing: NOTHING,
    };
    body = (
      <BoardContext.Provider value={context}>
        <BoardDnd>
          {module.kind === 'poll' ? (
            <PollBoard />
          ) : module.kind === 'questions' ? (
            <QuestionsBoard roomId={roomId} tags={tags.data ?? []} />
          ) : module.kind === 'ddi' ? (
            <DdiBoard roomId={roomId} />
          ) : (
            <RetroBoard />
          )}
        </BoardDnd>
      </BoardContext.Provider>
    );
  }

  const toggle = () => setExpanded((current) => !current);
  return (
    <Stack component="section" gap="sm" id={blockAnchor(block.id)} className="room-landing-block" aria-label={heading}>
      {bar ? (
        <Group gap={4} wrap="nowrap" align="flex-start">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            mt={2}
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={expanded ? t('roomLanding.foldBlock', { name: heading }) : t('roomLanding.unfoldBlock', { name: heading })}
          >
            {expanded ? <CaretDownIcon size={18} /> : <CaretRightIcon size={18} />}
          </ActionIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>{bar}</Box>
        </Group>
      ) : (
        <BlockHeading label={heading} expanded={expanded} onToggle={toggle} trailing={draft} />
      )}
      <Collapse expanded={expanded}>{body}</Collapse>
    </Stack>
  );
}
