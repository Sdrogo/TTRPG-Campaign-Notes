import { describe, expect, it } from 'vitest';
import { applyInsertions, LINK_PLACEHOLDER, markdownEdit, markdownShortcut } from '../../lib/markdownEditing';

function run(action: Parameters<typeof markdownEdit>[0], text: string, start: number, end: number) {
  const edit = markdownEdit(action, text, start, end);
  const result = applyInsertions(text, edit.insertions);
  return { result, selected: result.slice(...edit.selection), selection: edit.selection };
}

describe('markdownEdit', () => {
  it('wraps the selection in bold and keeps it selected', () => {
    expect(run('bold', 'la torre nera', 3, 8)).toMatchObject({
      result: 'la **torre** nera',
      selected: 'torre',
    });
  });

  it('puts the caret between the signs with nothing selected', () => {
    const { result, selection } = run('italic', 'ab', 1, 1);
    expect(result).toBe('a**b');
    expect(selection).toEqual([2, 2]);
  });

  it('prefixes every selected line', () => {
    expect(run('bulleted', 'uno\ndue\ntre', 0, 7).result).toBe('- uno\n- due\ntre');
    expect(run('numbered', 'uno\ndue', 1, 5).result).toBe('1. uno\n2. due');
    expect(run('quote', 'a\nb', 2, 2).result).toBe('a\n> b');
    expect(run('heading', 'Titolo', 3, 3)).toMatchObject({ result: '## Titolo', selection: [6, 6] });
  });

  it('stops at a line the selection only reaches the start of', () => {
    expect(run('bulleted', 'uno\ndue', 0, 4).result).toBe('- uno\ndue');
  });

  it('makes a link and selects its address', () => {
    expect(run('link', 'vedi qui', 5, 8)).toMatchObject({
      result: `vedi [qui](${LINK_PLACEHOLDER})`,
      selected: LINK_PLACEHOLDER,
    });
    expect(run('link', '', 0, 0)).toMatchObject({ result: `[](${LINK_PLACEHOLDER})`, selection: [1, 1] });
  });
});

describe('markdownShortcut', () => {
  const key = (
    k: string,
    extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

  it('reads Ctrl/Cmd+B, I and K', () => {
    expect(markdownShortcut(key('b', { ctrlKey: true }))).toBe('bold');
    expect(markdownShortcut(key('I', { metaKey: true }))).toBe('italic');
    expect(markdownShortcut(key('k', { ctrlKey: true }))).toBe('link');
    expect(markdownShortcut(key('b'))).toBeNull();
    expect(markdownShortcut(key('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
