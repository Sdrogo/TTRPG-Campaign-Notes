import type { DocumentVisibility } from '../types/document';
import type { Note, NoteFormValues } from '../types/note';

/** The longest Note title the backend accepts (`MAX_NOTE_TITLE_LENGTH`). */
export const MAX_NOTE_TITLE_LENGTH = 200;

/** A new Note's starting values; the Room's default visibility (VR-05) replaces `room`. */
export const EMPTY_NOTE_VALUES: NoteFormValues = {
  title: '',
  description: '',
  visibility: 'room',
  selectiveUserIds: [],
};

/** A Note as the backend sends it. */
export interface RawNote {
  id: string;
  document_id: string;
  title: string;
  description: string;
  visibility: DocumentVisibility;
  selective_user_ids: string[];
  position: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

/** Maps the wire shape to the app's `Note`. */
export function toNote(raw: RawNote): Note {
  return {
    id: raw.id,
    documentId: raw.document_id,
    title: raw.title,
    description: raw.description,
    visibility: raw.visibility,
    selectiveUserIds: raw.selective_user_ids,
    position: raw.position,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    canEdit: raw.can_edit,
    canDelete: raw.can_delete,
  };
}

/** The request body for creating or editing a Note. */
export function toNoteBody(values: NoteFormValues) {
  return {
    title: values.title,
    description: values.description,
    visibility: values.visibility,
    // Grants only mean something at the Selective level.
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
  };
}

/** A Note can be saved once it has a title. */
export function canSubmitNote(values: NoteFormValues): boolean {
  return values.title.trim() !== '';
}

/**
 * The ids with the one at `index` moved by `delta` places (-1 up, +1 down), or
 * the same order when that would leave the list. Never mutates its input.
 */
export function moveNote(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) {
    return ids;
  }
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
