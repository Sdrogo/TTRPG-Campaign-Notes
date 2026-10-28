import { Link } from 'react-router-dom';
import { Alert, Badge, Box, Button, Group, Loader, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { CheckIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MentionText } from '../mentions/MentionText';
import { documentsQueryKey, useDocument, useDocuments } from '../../hooks/useDocuments';
import { displayNameFor } from '../../lib/members';
import { boardWrites } from '../../lib/sessionZero';
import type { DdiStep, SessionZeroModule } from '../../types/sessionZero';
import { useBoard } from './boardContext';

/**
 * A DDI step (spec 47 Decisions 8 and 8a): one Document of the Room, read
 * here by every member who sees it. The Master picks it or makes it from the
 * template and sees who has accepted; each Player accepts it at the end,
 * again once it changed.
 */
export function DdiBoard({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const { board, module, writable } = useBoard();
  const step = module?.ddi;
  if (!module || !step) return null;
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  const editable = open && writable;
  return (
    <Box component="section" aria-label={t('sessionZero.modules.kinds.ddi')} className="sz-ddi">
      <Stack gap="md">
        {board.canManage ? (
          <MasterDdi roomId={roomId} module={module} step={step} editable={editable} />
        ) : (
          <PlayerDdi roomId={roomId} module={module} step={step} editable={editable} />
        )}
      </Stack>
    </Box>
  );
}

interface StepProps {
  roomId: string;
  module: SessionZeroModule;
  step: DdiStep;
  editable: boolean;
}

/** The Master's side: the Document picker, the template, the Document and who accepted it. */
function MasterDdi({ roomId, module, step, editable }: StepProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { act, busy } = useBoard();
  const documents = useDocuments(roomId, editable);
  const options = (documents.data ?? []).map((document) => ({ value: document.id, label: document.name }));
  return (
    <>
      {editable && (
        <Group align="flex-end" gap="sm">
          <Select
            size="xs"
            label={t('sessionZero.ddi.document')}
            placeholder={t('sessionZero.ddi.pick')}
            searchable
            clearable
            data={options}
            value={step.documentId}
            disabled={busy}
            onChange={(value) => act(boardWrites.setDdiDocument(module.id, value))}
            style={{ flex: 1, maxWidth: 360 }}
          />
          <Button
            size="xs"
            variant="default"
            disabled={busy}
            onClick={() =>
              act(boardWrites.createDdiFromTemplate(module.id), () =>
                queryClient.invalidateQueries({ queryKey: documentsQueryKey(roomId) }),
              )
            }
          >
            {t('sessionZero.ddi.fromTemplate')}
          </Button>
        </Group>
      )}
      {step.documentId ? (
        <>
          <Acceptances step={step} />
          <DdiDocument roomId={roomId} documentId={step.documentId} />
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {t('sessionZero.ddi.noneMaster')}
        </Text>
      )}
    </>
  );
}

/** Every Player, with a ✓ once they accepted, "To accept again" once the DDI changed after. */
function Acceptances({ step }: { step: DdiStep }) {
  const { t } = useTranslation();
  const { members } = useBoard();
  const players = members.filter((member) => member.role === 'player');
  return (
    <Paper withBorder radius="sm" p="xs">
      <Text size="sm" fw={600} mb={4}>
        {t('sessionZero.ddi.acceptances')}
      </Text>
      {players.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('sessionZero.ddi.noPlayers')}
        </Text>
      ) : (
        <Group gap="xs">
          {players.map((player) => {
            const acceptance = step.acceptances.find((candidate) => candidate.userId === player.userId);
            const name = displayNameFor(members, player.userId);
            if (!acceptance) {
              return (
                <Badge key={player.userId} variant="default" title={t('sessionZero.ddi.notYet')}>
                  {name}
                </Badge>
              );
            }
            return acceptance.outdated ? (
              <Badge key={player.userId} variant="light" color="yellow" title={t('sessionZero.ddi.outdated')}>
                {name} · {t('sessionZero.ddi.outdated')}
              </Badge>
            ) : (
              <Badge
                key={player.userId}
                variant="light"
                color="green"
                leftSection={<CheckIcon size={14} aria-hidden="true" />}
                title={t('sessionZero.ddi.accepted')}
              >
                {name}
              </Badge>
            );
          })}
        </Group>
      )}
    </Paper>
  );
}

/** A Player's side: the DDI when they see it, and "I have read and accept" at its end. */
function PlayerDdi({ roomId, module, step, editable }: StepProps) {
  const { t } = useTranslation();
  const { act, busy } = useBoard();
  if (step.documentHidden) {
    return (
      <Text size="sm" c="dimmed">
        {t('sessionZero.ddi.hidden')}
      </Text>
    );
  }
  if (!step.documentId) {
    return (
      <Text size="sm" c="dimmed">
        {t('sessionZero.ddi.nonePlayer')}
      </Text>
    );
  }
  const mine = step.acceptances.find((acceptance) => acceptance.mine);
  return (
    <>
      {mine?.outdated && (
        <Alert color="yellow" variant="light">
          {t('sessionZero.ddi.changed')}
        </Alert>
      )}
      <DdiDocument roomId={roomId} documentId={step.documentId} />
      {editable && (
        <Group gap="sm">
          {step.canAccept ? (
            <Button disabled={busy} onClick={() => act(boardWrites.acceptDdi(module.id, true))}>
              {t('sessionZero.ddi.accept')}
            </Button>
          ) : (
            mine && (
              <>
                <Text size="sm" c="green">
                  {t('sessionZero.ddi.youAccepted')}
                </Text>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  disabled={busy}
                  onClick={() => act(boardWrites.acceptDdi(module.id, false))}
                >
                  {t('sessionZero.ddi.withdraw')}
                </Button>
              </>
            )
          )}
        </Group>
      )}
    </>
  );
}

/** The DDI's Document, read-only: its name, description and the Notes the viewer sees. */
function DdiDocument({ roomId, documentId }: { roomId: string; documentId: string }) {
  const { t } = useTranslation();
  const document = useDocument(roomId, documentId, true);
  if (document.isPending) return <Loader size="sm" />;
  if (document.isError) {
    return (
      <Text size="sm" c="red">
        {t('sessionZero.ddi.loadError')}
      </Text>
    );
  }
  const { name, description, notes } = document.data;
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Title order={2} fz="h4">
            {name}
          </Title>
          <Button
            component={Link}
            to={`/rooms/${roomId}/documents/${documentId}`}
            size="compact-sm"
            variant="light"
            style={{ flexShrink: 0 }}
          >
            {t('sessionZero.ddi.open')}
          </Button>
        </Group>
        {description && (
          <MentionText text={description} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
        )}
        {notes.map((note) => (
          <Box key={note.id}>
            <Text fw={600}>{note.title}</Text>
            <MentionText text={note.description} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
