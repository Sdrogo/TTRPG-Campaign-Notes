import { describe, expect, it } from 'vitest';
import { rawNote } from '../fixtures';
import { EMPTY_NOTE_VALUES, canSubmitNote, moveNote, toNote, toNoteBody } from '../../lib/notes';
import type { RawNote } from '../../lib/notes';
import type { NoteFormValues } from '../../types/note';

function values(overrides: Partial<NoteFormValues> = {}): NoteFormValues {
  return { ...EMPTY_NOTE_VALUES, title: 'Porta segreta', ...overrides };
}

describe('toNote', () => {
  it('maps the wire shape onto the Note model', () => {
    expect(toNote(rawNote({ selective_user_ids: ['user-2'] }) as RawNote)).toEqual({
      id: 'note-1',
      documentId: 'doc-1',
      title: 'Porta segreta',
      description: 'Dietro la libreria.',
      visibility: 'room',
      selectiveUserIds: ['user-2'],
      position: 0,
      createdAt: '2026-10-01T12:00:00Z',
      updatedAt: '2026-10-01T12:00:00Z',
      canEdit: true,
      canDelete: true,
    });
  });
});

describe('toNoteBody', () => {
  it('sends the grants only at the Selective level', () => {
    const selective = toNoteBody(values({ visibility: 'selective', selectiveUserIds: ['user-2'] }));
    const room = toNoteBody(values({ visibility: 'room', selectiveUserIds: ['user-2'] }));

    expect(selective.selective_user_ids).toEqual(['user-2']);
    expect(room.selective_user_ids).toEqual([]);
    expect(room).toMatchObject({ title: 'Porta segreta', description: '', visibility: 'room' });
  });
});

describe('canSubmitNote', () => {
  it('needs a title that is not just whitespace', () => {
    expect(canSubmitNote(values())).toBe(true);
    expect(canSubmitNote(values({ title: '   ' }))).toBe(false);
    expect(canSubmitNote(EMPTY_NOTE_VALUES)).toBe(false);
  });
});

describe('moveNote', () => {
  it('swaps a Note with its neighbour', () => {
    expect(moveNote(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveNote(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('leaves the order alone at either end, without mutating', () => {
    const ids = ['a', 'b'];

    expect(moveNote(ids, 0, -1)).toBe(ids);
    expect(moveNote(ids, 1, 1)).toBe(ids);
    expect(ids).toEqual(['a', 'b']);
  });
});
