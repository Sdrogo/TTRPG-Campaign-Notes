import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Stack, Text, Title } from '@mantine/core';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockCounterClockwiseIcon,
  EyeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { VisibilityBadge } from '../VisibilityBadge';
import { RevealedBadge } from '../RevealedBadge';
import { MentionText } from '../mentions/MentionText';
import { NoteForm } from './NoteForm';
import type { Member } from '../../types/member';
import type { Note, NoteFormValues } from '../../types/note';
import { useTranslation } from 'react-i18next';

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
  /** Opens the Note's history (spec 24), offered with the other edit actions. */
  onHistory?: () => void;
}

/**
 * One Note, as a paragraph under the Document description: a small heading and
 * its text with the same `#` mentions. Editing, deleting and reordering are
 * offered only when the backend's `canEdit`/`canDelete` allow them; the
 * visibility badge is shown to the same people, since only they need it.
 * The Master can also reveal it, and a Note this visit opened as revealed to
 * the viewer is marked so (spec 22).
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
  onHistory,
}: NoteItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmDeleteOpened, setConfirmDeleteOpened] = useState(false);

  if (editing) {
    return (
      <NoteForm
        initialValues={{
          title: note.title,
          description: note.description,
          visibility: note.visibility,
          selectiveUserIds: note.selectiveUserIds,
        }}
        members={members}
        submitLabel={t('common.save')}
        onSubmit={(values) => onUpdate(values, () => setEditing(false))}
        submitting={updating}
        onCancel={() => setEditing(false)}
      />
    );
  }

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
          {note.canEdit && <VisibilityBadge visibility={note.visibility} size="xs" />}
          {revealed && <RevealedBadge size="xs" />}
        </Group>
        {(note.canEdit || note.canDelete || onReveal) && (
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            {onReveal && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={onReveal}
                aria-label={t('reveal.actionLabel', { name: note.title })}
              >
                <EyeIcon size={14} />
              </ActionIcon>
            )}
            {note.canEdit && (
              <>
                {onHistory && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={onHistory}
                    aria-label={t('versions.actionFor', { name: note.title })}
                  >
                    <ClockCounterClockwiseIcon size={14} />
                  </ActionIcon>
                )}
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  disabled={!canMoveUp || moving}
                  onClick={() => onMove(-1)}
                  aria-label={t('notes.moveUp', { title: note.title })}
                >
                  <ArrowUpIcon size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  disabled={!canMoveDown || moving}
                  onClick={() => onMove(1)}
                  aria-label={t('notes.moveDown', { title: note.title })}
                >
                  <ArrowDownIcon size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => setEditing(true)}
                  aria-label={t('notes.edit', { title: note.title })}
                >
                  <PencilSimpleIcon size={14} />
                </ActionIcon>
              </>
            )}
            {note.canDelete && (
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                onClick={() => setConfirmDeleteOpened(true)}
                aria-label={t('notes.delete', { title: note.title })}
              >
                <TrashIcon size={14} />
              </ActionIcon>
            )}
          </Group>
        )}
      </Group>
      {note.description && (
        <MentionText
          text={note.description}
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        />
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
