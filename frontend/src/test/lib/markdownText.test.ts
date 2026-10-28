import { describe, expect, it } from 'vitest';
import { markdownToPlain, safeLinkUrl } from '../../lib/markdownText';

const DOC = '00000000-0000-4000-8000-000000000001';

describe('markdownToPlain', () => {
  it('drops the signs and keeps the words', () => {
    expect(markdownToPlain('# Titolo\n\n**Drakon** e *Ilsa*\n\n- uno\n- due')).toBe(
      'Titolo\nDrakon e Ilsa\nuno\ndue',
    );
  });

  it('reads a link by its text and a table by its cells', () => {
    expect(markdownToPlain('[la locanda](https://example.com)\n\n| a | b |\n| - | - |\n| 1 | 2 |')).toBe(
      'la locanda\na, b\n1, 2',
    );
  });

  // Decision 4: tokens come back untouched, for MentionText to resolve.
  it('keeps mention tokens as stored', () => {
    const token = `#[Il Cancello](doc:${DOC})`;
    expect(markdownToPlain(`**${token}** e \`${token}\``)).toBe(`${token} e ${token}`);
  });

  it('joins blocks with the separator', () => {
    expect(markdownToPlain('uno\n\ndue', { separator: ' ' })).toBe('uno due');
  });

  // Decision 8.
  it('ends headings, list items and rows with a full stop for speech', () => {
    expect(markdownToPlain('## Luoghi\n\n- la torre\n- il porto!', { separator: ' ', sentences: true })).toBe(
      'Luoghi. la torre. il porto!',
    );
  });

  it('leaves plain text written before spec 48 as it was', () => {
    expect(markdownToPlain('riga uno\nriga due')).toBe('riga uno\nriga due');
  });
});

describe('safeLinkUrl', () => {
  it('keeps http, https and mailto only', () => {
    expect(safeLinkUrl('https://a.b')).toBe('https://a.b');
    expect(safeLinkUrl('http://a.b')).toBe('http://a.b');
    expect(safeLinkUrl('mailto:x@y.z')).toBe('mailto:x@y.z');
    expect(safeLinkUrl('javascript:alert(1)')).toBe('');
    expect(safeLinkUrl('data:text/html,x')).toBe('');
    expect(safeLinkUrl('/rooms/1')).toBe('');
  });
});
