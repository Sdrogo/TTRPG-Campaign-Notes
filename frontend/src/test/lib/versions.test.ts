import { describe, expect, it } from 'vitest';
import {
  compareTexts,
  isSameText,
  toVersion,
  toVersionDetail,
  type RawVersionDetail,
} from '../../lib/versions';
import { rawVersion } from '../fixtures';

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
    });
  });

  it('keeps the change size null for the first version', () => {
    expect(toVersion(rawVersion())).toMatchObject({ wordsAdded: null, wordsRemoved: null });
  });

  it('carries the text of a version in full', () => {
    const raw = { ...rawVersion(), description: 'Un cancello.' } as RawVersionDetail;

    expect(toVersionDetail(raw).description).toBe('Un cancello.');
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

describe('isSameText', () => {
  const current = { title: 'A', description: 'B' };

  it('is true when title and description match', () => {
    expect(isSameText({ title: 'A', description: 'B' }, current)).toBe(true);
  });

  it('is false when either differs', () => {
    expect(isSameText({ title: 'A', description: 'C' }, current)).toBe(false);
    expect(isSameText({ title: 'X', description: 'B' }, current)).toBe(false);
  });
});
