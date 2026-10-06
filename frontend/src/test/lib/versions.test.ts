import { describe, expect, it } from 'vitest';
import {
  compareNotes,
  compareTexts,
  isSameText,
  toVersion,
  toVersionDetail,
} from '../../lib/versions';
import { rawVersion, rawVersionDetail } from '../fixtures';

describe('toVersion', () => {
  it('maps the wire shape', () => {
    expect(toVersion(rawVersion({ words_added: 4, words_removed: 1 }))).toEqual({
      id: 'version-1',
      title: 'Il Cancello',
      editedBy: 'user-1',
      createdAt: '2026-10-05T12:00:00Z',
      updatedAt: '2026-10-05T12:00:00Z',
      wordsAdded: 4,
      wordsRemoved: 1,
      notesAdded: null,
      notesRemoved: null,
    });
  });

  it('keeps the change size null for the first version', () => {
    expect(toVersion(rawVersion())).toMatchObject({ wordsAdded: null, wordsRemoved: null });
  });

  it('carries the texts of a revision in full, its Notes included', () => {
    const note = { id: 'note-1', title: 'Chiave', description: 'Sotto.' };
    const detail = toVersionDetail(
      rawVersionDetail({ notes: [note], notes_added: 1, notes_removed: 0 }),
    );

    expect(detail.description).toBe('Un cancello.');
    expect(detail.notes).toEqual([note]);
    expect([detail.notesAdded, detail.notesRemoved]).toEqual([1, 0]);
  });
});

// Spec 24 Decision 4: word-level, the removed words on the old side and the
// added ones on the new side.
describe('compareTexts', () => {
  it('marks removed words on the left and added words on the right', () => {
    const { before, after } = compareTexts('Un vampiro alto', 'Un vampiro conte');

    expect(before.filter((p) => p.changed).map((p) => p.text.trim())).toEqual(['alto']);
    expect(after.filter((p) => p.changed).map((p) => p.text.trim())).toEqual(['conte']);
    expect(before.map((p) => p.text).join('')).toBe('Un vampiro alto');
    expect(after.map((p) => p.text).join('')).toBe('Un vampiro conte');
  });

  it('marks nothing for identical texts', () => {
    const { before, after } = compareTexts('Uguale', 'Uguale');

    expect(before).toEqual([{ text: 'Uguale', changed: false }]);
    expect(after).toEqual([{ text: 'Uguale', changed: false }]);
  });

  it('compares mentions as the names a reader sees, not as stored', () => {
    const { before } = compareTexts(
      'Vedi #[Strahd](doc:7b8e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b).',
      'Vedi altro.',
    );

    expect(before.map((p) => p.text).join('')).toBe('Vedi #Strahd.');
  });
});

const NOTE = { id: 'note-1', title: 'Chiave', description: 'Sotto.' };
const OTHER = { id: 'note-2', title: 'Porta', description: 'A est.' };

describe('isSameText', () => {
  const current = { title: 'A', description: 'B', notes: [NOTE, OTHER] };

  it('is true when the name, the description and the Notes match', () => {
    expect(isSameText({ ...current, notes: [NOTE, OTHER] }, current)).toBe(true);
  });

  it('is false when any of them differs, the order of the Notes included', () => {
    expect(isSameText({ ...current, description: 'C' }, current)).toBe(false);
    expect(isSameText({ ...current, title: 'X' }, current)).toBe(false);
    expect(isSameText({ ...current, notes: [OTHER, NOTE] }, current)).toBe(false);
    expect(isSameText({ ...current, notes: [NOTE] }, current)).toBe(false);
    expect(isSameText({ ...current, notes: [{ ...NOTE, title: 'Altra' }, OTHER] }, current)).toBe(
      false,
    );
    expect(
      isSameText({ ...current, notes: [{ ...NOTE, description: 'Altro.' }, OTHER] }, current),
    ).toBe(false);
  });
});

// Spec 24b Decision 4: Notes are matched by id.
describe('compareNotes', () => {
  it("lists the revision's Notes, then the ones added since", () => {
    const added = { id: 'note-3', title: 'Nuova', description: '' };
    const changed = { ...NOTE, description: 'Altrove.' };

    expect(compareNotes([NOTE, OTHER], [added, changed])).toEqual([
      { id: 'note-1', status: 'kept', before: NOTE, after: changed },
      { id: 'note-2', status: 'removed', before: OTHER, after: null },
      { id: 'note-3', status: 'added', before: null, after: added },
    ]);
  });
});
