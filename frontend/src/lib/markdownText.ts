import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast';
import type { Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { splitMentionTokens } from './mentionTokens';

// Markdown in Document descriptions and Note texts (spec 48). The text is
// stored as written, mention tokens included; these helpers read it.
//
// A mention token `#[Name](doc:<uuid>)` looks like a Markdown link, so before
// the text is parsed every mention is swapped for a placeholder of
// private-use characters (Decision 4), which Markdown reads as an ordinary
// word, and put back afterwards.

const OPEN = '';
const CLOSE = '';

/** The placeholder standing for the `index`th lifted mention. */
export function mentionPlaceholder(index: number): string {
  return `${OPEN}${index}${CLOSE}`;
}

/** Text split into plain runs and the indexes of the placeholders in it. */
export function splitPlaceholders(text: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const pattern = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(Number(match[1]));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Only `http`, `https` and `mailto` addresses are links (Decision 3); anything
 * else (`javascript:`, `data:`, a relative path) gives an empty string, which
 * `MarkdownText` shows as plain text.
 */
export function safeLinkUrl(url: string): string {
  const trimmed = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : '';
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** How `markdownToPlain` joins what it reads. */
export interface PlainOptions {
  /** Between two blocks (paragraphs, headings, list items, table rows). Default a newline. */
  separator?: string;
  /** End every heading, list item and table row with a full stop, so a voice pauses (Decision 8). */
  sentences?: boolean;
}

/**
 * The words of a Markdown text without its signs (Decision 6 and 8):
 * `**Drakon**` reads `Drakon`, a link its text, a table its cells. Mention
 * tokens come back untouched, so the result still goes through
 * `MentionText` or `mentionsToSpeech`.
 */
export function markdownToPlain(text: string, options: PlainOptions = {}): string {
  const { separator = '\n', sentences = false } = options;
  // Cards call this on every render: keep the latest results.
  const key = `${sentences ? 1 : 0}${separator}\u0000${text}`;
  const cached = plainCache.get(key);
  if (cached !== undefined) return cached;
  const plain = toPlain(text, separator, sentences);
  if (plainCache.size >= PLAIN_CACHE_SIZE) {
    plainCache.delete(plainCache.keys().next().value!);
  }
  plainCache.set(key, plain);
  return plain;
}

const PLAIN_CACHE_SIZE = 500;
const plainCache = new Map<string, string>();

function toPlain(text: string, separator: string, sentences: boolean): string {
  const tokens: string[] = [];
  const lifted = splitMentionTokens(text, { users: true })
    .map((segment) => {
      if (segment.kind === 'text') return segment.stored;
      tokens.push(segment.stored);
      return mentionPlaceholder(tokens.length - 1);
    })
    .join('');
  const blocks: string[] = [];

  const inline = (node: Nodes): string => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        return node.value;
      case 'break':
        return '\n';
      case 'image':
        return node.alt as string;
      case 'html':
        return node.value;
      default:
        return 'children' in node ? node.children.map((child) => inline(child as Nodes)).join('') : '';
    }
  };

  const push = (value: string, sentence: boolean) => {
    let line = value.trim();
    if (!line) return;
    if (sentences && sentence && !/[.!?:;…]$/.test(line)) line += '.';
    blocks.push(line);
  };

  const block = (node: Nodes, inListItem = false) => {
    switch (node.type) {
      case 'root':
      case 'blockquote':
      case 'list':
        node.children.forEach((child) => block(child as Nodes));
        return;
      case 'listItem':
        node.children.forEach((child) => block(child as Nodes, true));
        return;
      case 'table':
        node.children.forEach((row) => push(row.children.map((cell) => inline(cell)).join(', '), true));
        return;
      case 'code':
        push(node.value, false);
        return;
      case 'thematicBreak':
        return;
      case 'paragraph':
        push(inline(node), inListItem);
        return;
      case 'heading':
        push(inline(node), true);
        return;
      default:
        push(inline(node), false);
    }
  };

  block(parser.parse(lifted) as Root);
  return splitPlaceholders(blocks.join(separator))
    .map((part) => (typeof part === 'number' ? tokens[part] : part))
    .join('');
}

/**
 * A rehype plugin for `MarkdownText`: each placeholder becomes `<span data-mention="i">`, rendered by
 * `components.span` as the mention it stands for. Inside code the mention is
 * shown as written (`written`), not linked (Decision 4); inside a Markdown
 * link it is only colored, since links can't nest.
 */
export function rehypePlaceMentions(written: string[]) {
  const visit = (node: HastRoot | Element, inLink: boolean) => {
    const children: (RootContent | ElementContent)[] = [];
    for (const child of node.children) {
      if (child.type === 'element') {
        if (child.tagName === 'code' || child.tagName === 'pre') {
          restoreWritten(child, written);
        } else {
          visit(child, inLink || child.tagName === 'a');
        }
        children.push(child);
      } else if (child.type === 'text') {
        for (const part of splitPlaceholders(child.value)) {
          children.push(
            typeof part === 'number'
              ? {
                  type: 'element',
                  tagName: 'span',
                  properties: { dataMention: String(part), dataInLink: inLink ? 'true' : undefined },
                  children: [],
                }
              : { type: 'text', value: part },
          );
        }
      } else {
        children.push(child);
      }
    }
    node.children = children as typeof node.children;
  };
  return () => (tree: HastRoot) => visit(tree, false);
}

function restoreWritten(node: Element, written: string[]) {
  for (const child of node.children) {
    if (child.type === 'text') {
      child.value = splitPlaceholders(child.value)
        .map((part) => (typeof part === 'number' ? written[part] : part))
        .join('');
    } else if (child.type === 'element') {
      restoreWritten(child, written);
    }
  }
}
