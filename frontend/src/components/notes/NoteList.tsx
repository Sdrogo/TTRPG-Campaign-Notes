import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Stack } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { NoteForm } from './NoteForm';
import { NoteItem } from './NoteItem';
import { RevealModal } from '../RevealModal';
import { useCreateNote, useDeleteNote, useReorderNotes, useUpdateNote } from '../../hooks/useNotes';
import { useRevealNote, useRevealedInVisit } from '../../hooks/useReveals';
import { useReadOnly } from '../../hooks/useViewAs';
import { revealAnchor } from '../../lib/anchors';
import { EMPTY_NOTE_VALUES, moveNote } from '../../lib/notes';
import { notifyError, notifySuccess } from '../../lib/notify';
import { noteReveal } from '../../lib/reveal';
import type { Document, DocumentVisibility } from '../../types/document';
import type { Member } from '../../types/member';
import type { Note } from '../../types/note';
import { useTranslation } from 'react-i18next';

const NOTE_ANCHOR = '#note-';

interface NoteListProps {
  roomId: string;
  documentId: string;
  /** Exactly what the backend returned: it already left out hidden Notes. */
  notes: Note[];
  members: Member[];
  /** Whether the viewer may add a Note (an Owner or the Master). */
  canAdd: boolean;
  /** The Room's default visibility, which a new Note starts at (VR-05). */
  defaultVisibility?: DocumentVisibility;
  /**
   * For the Master: the Document the Notes are on, whose audience decides who
   * a Note's Reveal reaches (spec 22). Without it nobody can reveal a Note.
   */
  revealFrom?: Document;
}

/**
 * A Document's Notes, one paragraph each under its description, and the
 * "add Note" action for those allowed. With no Notes and no right to add one
 * it renders nothing, so a Document looks as it did before Notes existed.
 * The Master can reveal a Note not yet seen by the whole Room (spec 22).
 * While the Master previews the Room as a member (spec 22b) no Note can be
 * changed, whatever the member could do. A `#note-<id>` anchor scrolls to
 * that Note (spec 21).
 */
export function NoteList({
  roomId,
  documentId,
  notes,
  members,
  canAdd,
  defaultVisibility = 'room',
  revealFrom,
}: NoteListProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const createNote = useCreateNote(roomId, documentId);
  const updateNote = useUpdateNote(roomId, documentId);
  const deleteNote = useDeleteNote(roomId, documentId);
  const reorderNotes = useReorderNotes(roomId, documentId);
  const revealNote = useRevealNote(roomId, documentId);
  const revealed = useRevealedInVisit(roomId, documentId);
  const readOnly = useReadOnly();
  // `#note-<id>`, where a search result leads (spec 21): once that Note is on
  // the page it scrolls into view and lights up, once per anchor.
  const { hash } = useLocation();
  const reachedAnchor = useRef<string | null>(null);
  useEffect(() => {
    if (
      hash === reachedAnchor.current ||
      !notes.some((note) => `${NOTE_ANCHOR}${note.id}` === hash)
    ) {
      return;
    }
    revealAnchor(hash.slice(1));
    reachedAnchor.current = hash;
  }, [hash, notes]);

  if (notes.length === 0 && !canAdd) {
    return null;
  }

  const ids = notes.map((note) => note.id);
  const revealing = notes.find((note) => note.id === revealingId);

  return (
    <Stack gap="md" className="note-list">
      {notes.map((note, index) => (
        <NoteItem
          key={note.id}
          note={readOnly ? { ...note, canEdit: false, canDelete: false } : note}
          members={members}
          canMoveUp={index > 0}
          canMoveDown={index < notes.length - 1}
          onMove={(delta) =>
            reorderNotes.mutate(moveNote(ids, index, delta), { onError: notifyError })
          }
          moving={reorderNotes.isPending}
          onUpdate={(values, onDone) =>
            updateNote.mutate(
              { noteId: note.id, values },
              { onSuccess: onDone, onError: notifyError },
            )
          }
          updating={updateNote.isPending && updateNote.variables.noteId === note.id}
          onDelete={() => deleteNote.mutate(note.id, { onError: notifyError })}
          deleting={deleteNote.isPending && deleteNote.variables === note.id}
          revealed={revealed?.noteIds.includes(note.id)}
          onReveal={
            revealFrom && note.visibility !== 'room' ? () => setRevealingId(note.id) : undefined
          }
        />
      ))}
      {canAdd &&
        (adding ? (
          <NoteForm
            initialValues={{ ...EMPTY_NOTE_VALUES, visibility: defaultVisibility }}
            members={members}
            submitLabel={t('notes.add')}
            onSubmit={(values) =>
              createNote.mutate(values, {
                onSuccess: () => setAdding(false),
                onError: notifyError,
              })
            }
            submitting={createNote.isPending}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<PlusIcon size={14} />}
            onClick={() => setAdding(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('notes.add')}
          </Button>
        ))}
      {revealing && revealFrom && (
        <RevealModal
          name={revealing.title}
          members={members}
          {...noteReveal(revealing, revealFrom, members)}
          loading={revealNote.isPending}
          onConfirm={(audience) =>
            revealNote.mutate(
              { noteId: revealing.id, audience },
              {
                onSuccess: () => {
                  notifySuccess(t('reveal.done'));
                  setRevealingId(null);
                },
                onError: notifyError,
              },
            )
          }
          onClose={() => setRevealingId(null)}
        />
      )}
    </Stack>
  );
}
