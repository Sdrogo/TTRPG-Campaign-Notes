import { useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Badge, Button, Group, Modal, Stack, Text, Title } from '@mantine/core';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  GraphIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { VisibilityBadge } from '../VisibilityBadge';
import { RevealedBadge } from '../RevealedBadge';
import { MarkdownText } from '../mentions/MarkdownText';
import { NoteForm } from './NoteForm';
import { ReadAloudControls } from '../speech/ReadAloudControls';
import { noteSpeech } from '../../lib/speech';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import type { Member } from '../../types/member';
import type { Note, NoteFormValues } from '../../types/note';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';

interface NoteItemProps {
  note: Note;
  members: Member[];
  /** Whether the Note has a neighbour to swap with in that direction. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  moving: boolean;
  onUpdate: (values: NoteFormValues, onDone: () => void) => void;
  updating: boolean;
  onDelete: () => void;
  deleting: boolean;
  /** Whether this visit opened the Note as revealed to the viewer (spec 22). */
  revealed?: boolean;
  /** The Master's Reveal action (spec 22 Decision 1); absent for everyone else. */
  onReveal?: () => void;
}

/**
 * One Note, as a paragraph under the Document description: a small heading and
 * its text with the same `#` mentions. Editing, deleting and reordering are
 * offered only when the backend's `canEdit`/`canDelete` allow them; the
 * visibility badge is shown to the same people, since only they need it.
 * The Master can also reveal it, and a Note this visit opened as revealed to
 * the viewer is marked so (spec 22). Every reader can hear it read aloud
 * on its own (spec 30), and sees whether it is a Relational link, whose
 * mentions draw the mention map (spec 41).
 */
export function NoteItem({
  note,
  members,
  canMoveUp,
  canMoveDown,
  onMove,
  moving,
  onUpdate,
  updating,
  onDelete,
  deleting,
  revealed = false,
  onReveal,
}: NoteItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmDeleteOpened, setConfirmDeleteOpened] = useState(false);
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const mentions = useDocumentMentions();

  if (editing) {
    return (
      <NoteForm
        initialValues={{
          title: note.title,
          description: note.description,
          visibility: note.visibility,
          selectiveUserIds: note.selectiveUserIds,
          relationalLink: note.relationalLink,
        }}
        members={members}
        submitLabel={t('common.save')}
        onSubmit={(values) => onUpdate(values, () => setEditing(false))}
        submitting={updating}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const readAloud = (
    <ReadAloudControls
      sourceId={`note:${note.id}`}
      name={note.title}
      getText={() => noteSpeech(note, mentions)}
      size="sm"
    />
  );
  const actions = (
    <>
      {onReveal && (
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={onReveal}
          aria-label={t('reveal.actionLabel', { name: note.title })}
        >
          <EyeIcon size={16} />
        </LabeledActionIcon>
      )}
      {note.canEdit && (
        <>
          <LabeledActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            disabled={!canMoveUp || moving}
            onClick={() => onMove(-1)}
            aria-label={t('notes.moveUp', { title: note.title })}
          >
            <ArrowUpIcon size={16} />
          </LabeledActionIcon>
          <LabeledActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            disabled={!canMoveDown || moving}
            onClick={() => onMove(1)}
            aria-label={t('notes.moveDown', { title: note.title })}
          >
            <ArrowDownIcon size={16} />
          </LabeledActionIcon>
          <LabeledActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={t('notes.edit', { title: note.title })}
          >
            <PencilSimpleIcon size={16} />
          </LabeledActionIcon>
        </>
      )}
      {note.canDelete && (
        <LabeledActionIcon
          variant="subtle"
          color="red"
          size="sm"
          onClick={() => setConfirmDeleteOpened(true)}
          aria-label={t('notes.delete', { title: note.title })}
        >
          <TrashIcon size={16} />
        </LabeledActionIcon>
      )}
    </>
  );
  const hasActions = Boolean(onReveal) || note.canEdit || note.canDelete;

  return (
    <Stack gap={4} id={`note-${note.id}`} className="note-item" data-testid="note-item">
      <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
        <Group gap="xs" wrap="wrap" style={{ minWidth: 0 }}>
          <Title
            order={2}
            fz="h4"
            style={{ fontFamily: 'var(--font-display)', overflowWrap: 'anywhere' }}
          >
            {note.title}
          </Title>
          {note.canEdit && (
            <VisibilityBadge visibility={note.visibility} size="xs" compact={phone} />
          )}
          {revealed && <RevealedBadge size="xs" />}
          {note.relationalLink && (
            <Badge
              size="xs"
              variant="light"
              color="gray"
              leftSection={<GraphIcon size={14} />}
              aria-label={phone ? t('notes.relationalLink') : undefined}
            >
              {phone ? null : t('notes.relationalLink')}
            </Badge>
          )}
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {readAloud}
          {!phone && actionsExpanded && actions}
          {hasActions && (
            <LabeledActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t('notes.actions', { title: note.title })}
              aria-expanded={actionsExpanded}
              onClick={() => setActionsExpanded((current) => !current)}
            >
              <DotsThreeVerticalIcon size={16} />
            </LabeledActionIcon>
          )}
        </Group>
      </Group>
      {phone && actionsExpanded && (
        <Group gap={4} wrap="wrap" justify="flex-end">
          {actions}
        </Group>
      )}
      {note.description && (
        <MarkdownText text={note.description} style={{ overflowWrap: 'anywhere' }} />
      )}

      <Modal
        opened={confirmDeleteOpened}
        onClose={() => setConfirmDeleteOpened(false)}
        title={t('notes.deleteConfirmTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('notes.deleteConfirmBody', { title: note.title })}</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setConfirmDeleteOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={() => {
                setConfirmDeleteOpened(false);
                onDelete();
              }}
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
