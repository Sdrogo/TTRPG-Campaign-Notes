import { describe, expect, it } from 'vitest';
import type { Root } from 'hast';
import {
  markdownToPlain,
  mentionPlaceholder,
  rehypePlaceMentions,
  safeLinkUrl,
} from '../../lib/markdownText';

const DOC = '00000000-0000-4000-8000-000000000001';

describe('markdownToPlain', () => {
  it('drops the signs and keeps the words', () => {
    expect(markdownToPlain('# Titolo\n\n**Drakon** e *Ilsa*\n\n- uno\n- due')).toBe(
      'Titolo\nDrakon e Ilsa\nuno\ndue',
    );
  });

  it('drops pasted placeholder characters, so they are no mention', () => {
    expect(markdownToPlain(`${mentionPlaceholder(7)} Mura`)).toBe('7 Mura');
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
    expect(
      markdownToPlain('## Luoghi\n\n- la torre\n- il porto!', {
        separator: ' ',
        sentences: true,
      }),
    ).toBe('Luoghi. la torre. il porto!');
  });

  it('reads code, images, raw HTML and footnotes as their words, a rule as nothing', () => {
    expect(
      markdownToPlain(
        '```\nfenced\n```\n\n---\n\n![mappa](https://a.b/m.png)![](https://a.b/n.png) <b>x</b>',
      ),
    ).toBe('fenced\nmappa <b>x</b>');
    expect(markdownToPlain('a[^1]\n\n[^1]: nota')).toBe('a\nnota');
  });

  it('keeps only the latest results', () => {
    for (let index = 0; index < 600; index += 1) {
      expect(markdownToPlain(`**${index}**`)).toBe(String(index));
    }
    expect(markdownToPlain('**0**')).toBe('0');
  });

  it('leaves plain text written before spec 48 as it was', () => {
    expect(markdownToPlain('riga uno\nriga due')).toBe('riga uno\nriga due');
    // An empty heading adds nothing.
    expect(markdownToPlain('#\n\ntesto')).toBe('testo');
    // A hard break (two spaces or a backslash) is a line break too.
    expect(markdownToPlain('riga uno\\\nriga due')).toBe('riga uno\nriga due');
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

describe('rehypePlaceMentions', () => {
  it('turns placeholders into mention spans, and back into the written words inside code', () => {
    const placeholder = mentionPlaceholder(0);
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'comment', value: 'kept' },
        {
          type: 'element',
          tagName: 'a',
          properties: {},
          children: [{ type: 'text', value: `x ${placeholder}` }],
        },
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [
                { type: 'text', value: `y ${placeholder}` },
                { type: 'comment', value: 'also kept' },
              ],
            },
          ],
        },
      ],
    };

    rehypePlaceMentions(['#Il Cancello'])()(tree);

    expect(tree.children[0]).toEqual({ type: 'comment', value: 'kept' });
    expect(tree.children[1]).toMatchObject({
      children: [
        { type: 'text', value: 'x ' },
        {
          tagName: 'span',
          properties: { dataMention: '0', dataInLink: 'true' },
        },
      ],
    });
    expect(tree.children[2]).toMatchObject({
      children: [
        {
          children: [{ type: 'text', value: 'y #Il Cancello' }, { type: 'comment' }],
        },
      ],
    });
  });
});
