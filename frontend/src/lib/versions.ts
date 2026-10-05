import { diffWords } from 'diff';
import { toDisplay } from './mentionTokens';
import type { Version, VersionDetail } from '../types/version';

/** A version as the backend sends it (no text). */
export interface RawVersion {
  id: string;
  title: string;
  edited_by: string;
  created_at: string;
  updated_at: string;
  words_added: number | null;
  words_removed: number | null;
}

/** A version with its text, as the backend sends it. */
export interface RawVersionDetail extends RawVersion {
  description: string;
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
  };
}

/** Maps the wire shape of one version in full to `VersionDetail`. */
export function toVersionDetail(raw: RawVersionDetail): VersionDetail {
  return { ...toVersion(raw), description: raw.description };
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

/** Whether a version's text is the one in force: nothing to compare or restore. */
export function isSameText(
  version: { title: string; description: string },
  current: { title: string; description: string },
): boolean {
  return version.title === current.title && version.description === current.description;
}
