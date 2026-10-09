import { describe, expect, it } from 'vitest';
import { personalDataFileName, privacyBlocks } from '../../lib/privacy';

describe('personalDataFileName', () => {
  it('dates the file with zero-padded local parts', () => {
    expect(personalDataFileName(new Date(2026, 0, 5, 23, 59))).toBe('ex-libris-my-data-2026-01-05.json');
  });
});

describe('privacyBlocks', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    expect(privacyBlocks('First\nline.\n\n  \n\nSecond.')).toEqual([
      { kind: 'text', text: 'First line.' },
      { kind: 'text', text: 'Second.' },
    ]);
  });

  it('turns a block of "- " lines into a list', () => {
    expect(privacyBlocks('Intro:\n\n- one\n- two')).toEqual([
      { kind: 'text', text: 'Intro:' },
      { kind: 'list', items: ['one', 'two'] },
    ]);
  });

  it('keeps a block with any plain line as text', () => {
    expect(privacyBlocks('- one\nnot a bullet')).toEqual([
      { kind: 'text', text: '- one not a bullet' },
    ]);
  });
});
