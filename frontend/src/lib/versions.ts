import { diffWords } from 'diff';
import { toDisplay } from './mentionTokens';
import type { Version, VersionDetail, VersionNote } from '../types/version';

/** A version as the backend sends it (no text). */
export interface RawVersion {
  id: string;
  title: string;
  edited_by: string;
  created_at: string;
  updated_at: string;
  words_added: number | null;
  words_removed: number | null;
  notes_added: number | null;
  notes_removed: number | null;
}

/** A version with its texts, as the backend sends it. */
export interface RawVersionDetail extends RawVersion {
  description: string;
  notes: VersionNote[];
}

/** Maps the wire shape to the app's `Version`. */
export function toVersion(raw: RawVersion): Version {
  return {
    id: raw.id,
    title: raw.title,
    editedBy: raw.edited_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    wordsAdded: raw.words_added,
    wordsRemoved: raw.words_removed,
    notesAdded: raw.notes_added,
    notesRemoved: raw.notes_removed,
  };
}

/** Maps the wire shape of one version in full to `VersionDetail`. */
export function toVersionDetail(raw: RawVersionDetail): VersionDetail {
  return {
    ...toVersion(raw),
    description: raw.description,
    notes: raw.notes.map((note) => ({
      id: note.id,
      title: note.title,
      description: note.description,
    })),
  };
}

/** A run of text in one side of a comparison, `changed` when it isn't on the other side. */
export interface DiffPart {
  text: string;
  changed: boolean;
}

/** Both sides of a word-level comparison between an old text and a new one. */
export interface SideBySide {
  before: DiffPart[];
  after: DiffPart[];
}

/**
 * Compares two texts word by word (spec 24 Decision 4): `before` marks the
 * words the new text lacks, `after` the words it added. Mention tokens are
 * compared as the names a reader sees (`#Name`), not as stored.
 */
export function compareTexts(oldText: string, newText: string): SideBySide {
  const before: DiffPart[] = [];
  const after: DiffPart[] = [];
  for (const change of diffWords(toDisplay(oldText), toDisplay(newText))) {
    if (!change.added) {
      before.push({ text: change.value, changed: Boolean(change.removed) });
    }
    if (!change.removed) {
      after.push({ text: change.value, changed: Boolean(change.added) });
    }
  }
  return { before, after };
}

/** A Document's texts as a revision holds them: what the comparison and the restore look at. */
export interface DocumentText {
  title: string;
  description: string;
  notes: VersionNote[];
}

/** Whether two revisions read the same: nothing to compare or restore. */
export function isSameText(version: DocumentText, current: DocumentText): boolean {
  return (
    version.title === current.title &&
    version.description === current.description &&
    version.notes.length === current.notes.length &&
    version.notes.every((note, index) => {
      const other = current.notes[index];
      return (
        note.id === other.id && note.title === other.title && note.description === other.description
      );
    })
  );
}

/**
 * A Note in the comparison of a revision with the current one (spec 24b
 * Decision 4): in both (`kept`, maybe changed), only in the revision
 * (`removed` since, a restore brings it back) or only now (`added` since, a
 * restore deletes it). `before` and `after` are the two sides; the missing one
 * is null.
 */
export interface NoteComparison {
  id: string;
  status: 'kept' | 'removed' | 'added';
  before: VersionNote | null;
  after: VersionNote | null;
}

/**
 * Pairs the Notes of a revision with the current ones by id: the revision's in
 * its order, then the ones added since in theirs.
 */
export function compareNotes(before: VersionNote[], after: VersionNote[]): NoteComparison[] {
  const now = new Map(after.map((note) => [note.id, note]));
  const then = new Set(before.map((note) => note.id));
  return [
    ...before.map((note): NoteComparison => {
      const current = now.get(note.id) ?? null;
      return {
        id: note.id,
        status: current ? 'kept' : 'removed',
        before: note,
        after: current,
      };
    }),
    ...after
      .filter((note) => !then.has(note.id))
      .map(
        (note): NoteComparison => ({
          id: note.id,
          status: 'added',
          before: null,
          after: note,
        }),
      ),
  ];
}
