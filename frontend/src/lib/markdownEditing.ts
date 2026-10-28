// The Markdown toolbar of a description or Note field (spec 48 Decision 7).
// Every action is a list of insertions into what the textarea shows, so a
// mention token inside the selection is never rewritten: only signs are
// added around it.

/** Text to add at a position of what the textarea shows. */
export interface Insertion {
  at: number;
  text: string;
}

/** What an action adds, and the selection to leave afterwards. */
export interface MarkdownEdit {
  insertions: Insertion[];
  selection: [number, number];
}

/** The toolbar's actions. */
export type MarkdownAction = 'bold' | 'italic' | 'heading' | 'bulleted' | 'numbered' | 'quote' | 'link';

const WRAPS: Partial<Record<MarkdownAction, string>> = { bold: '**', italic: '*' };

const LINE_PREFIXES: Partial<Record<MarkdownAction, string>> = {
  heading: '## ',
  bulleted: '- ',
  quote: '> ',
};

/** The address a new link starts with, selected so typing replaces it. */
export const LINK_PLACEHOLDER = 'https://';

// Where each line touched by `start`…`end` begins.
function lineStarts(text: string, start: number, end: number): number[] {
  const starts = [text.lastIndexOf('\n', start - 1) + 1];
  // A selection ending right at a line start (a whole line picked) stops before it.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  for (
    let index = text.indexOf('\n', starts[0]);
    index !== -1 && index < last;
    index = text.indexOf('\n', index + 1)
  ) {
    starts.push(index + 1);
  }
  return starts;
}

// Where `position` lands once `insertions` are in (one exactly at it goes
// before it).
function shift(position: number, insertions: Insertion[]): number {
  return insertions.reduce(
    (moved, insertion) => (insertion.at <= position ? moved + insertion.text.length : moved),
    position,
  );
}

/** What `action` adds to `text` (as the textarea shows it) with `start`…`end` selected. */
export function markdownEdit(action: MarkdownAction, text: string, start: number, end: number): MarkdownEdit {
  const wrap = WRAPS[action];
  if (wrap) {
    if (start === end) {
      return {
        insertions: [{ at: start, text: wrap + wrap }],
        selection: [start + wrap.length, start + wrap.length],
      };
    }
    const insertions = [
      { at: start, text: wrap },
      { at: end, text: wrap },
    ];
    return { insertions, selection: [start + wrap.length, end + wrap.length] };
  }
  if (action === 'link') {
    if (start === end) {
      const written = `[](${LINK_PLACEHOLDER})`;
      return { insertions: [{ at: start, text: written }], selection: [start + 1, start + 1] };
    }
    const insertions = [
      { at: start, text: '[' },
      { at: end, text: `](${LINK_PLACEHOLDER})` },
    ];
    const urlStart = end + 3;
    return { insertions, selection: [urlStart, urlStart + LINK_PLACEHOLDER.length] };
  }
  const starts = lineStarts(text, start, end);
  const insertions = starts.map((at, index) => ({
    at,
    text: action === 'numbered' ? `${index + 1}. ` : (LINE_PREFIXES[action] ?? ''),
  }));
  return { insertions, selection: [shift(start, insertions), shift(end, insertions)] };
}

/** `text` with `insertions` in. */
export function applyInsertions(text: string, insertions: Insertion[]): string {
  return insertions
    .toSorted((a, b) => b.at - a.at)
    .reduce(
      (result, insertion) => result.slice(0, insertion.at) + insertion.text + result.slice(insertion.at),
      text,
    );
}

/** The action a key press asks for: Ctrl/Cmd+B, I and K. */
export function markdownShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): MarkdownAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'k':
      return 'link';
    default:
      return null;
  }
}
