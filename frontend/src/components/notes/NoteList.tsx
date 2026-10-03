import { useState } from 'react';
import { Button, Stack } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { NoteForm } from './NoteForm';
import { NoteItem } from './NoteItem';
import { useCreateNote, useDeleteNote, useReorderNotes, useUpdateNote } from '../../hooks/useNotes';
import { EMPTY_NOTE_VALUES, moveNote } from '../../lib/notes';
import { notifyError } from '../../lib/notify';
import type { Member } from '../../types/member';
import type { Note } from '../../types/note';
import { useTranslation } from 'react-i18next';

interface NoteListProps {
  roomId: string;
  documentId: string;
  /** Exactly what the backend returned: it already left out hidden Notes. */
  notes: Note[];
  members: Member[];
  /** Whether the viewer may add a Note (an Owner or the Master). */
  canAdd: boolean;
}

/**
 * A Document's Notes, one paragraph each under its description, and the
 * "add Note" action for those allowed. With no Notes and no right to add one
 * it renders nothing, so a Document looks as it did before Notes existed.
 */
export function NoteList({ roomId, documentId, notes, members, canAdd }: NoteListProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const createNote = useCreateNote(roomId, documentId);
  const updateNote = useUpdateNote(roomId, documentId);
  const deleteNote = useDeleteNote(roomId, documentId);
  const reorderNotes = useReorderNotes(roomId, documentId);

  if (notes.length === 0 && !canAdd) {
    return null;
  }

  const ids = notes.map((note) => note.id);

  return (
    <Stack gap="md" className="note-list">
      {notes.map((note, index) => (
        <NoteItem
          key={note.id}
          note={note}
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
        />
      ))}
      {canAdd &&
        (adding ? (
          <NoteForm
            initialValues={EMPTY_NOTE_VALUES}
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
    </Stack>
  );
}
