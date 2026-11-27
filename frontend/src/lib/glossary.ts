import type {
  GlossaryEntry,
  GlossaryFormValues,
  RawGlossaryEntry,
} from '../types/glossary';

/** The limits the backend enforces (`app/domain/glossary.py`). */
export const MAX_TERM_LENGTH = 120;
export const MAX_ALIASES = 10;
export const MAX_DEFINITION_LENGTH = 10_000;
export const MAX_RELATED_DOCUMENTS = 20;

/** The Glossary page, scrolled to an entry. */
export function glossaryEntryHref(roomId: string, entryId: string): string {
  return `/rooms/${roomId}/glossary?entry=${entryId}`;
}

/** A new entry's starting values; the Room's default visibility (VR-05) replaces `room`. */
export const EMPTY_GLOSSARY_VALUES: GlossaryFormValues = {
  term: '',
  aliases: [],
  definition: '',
  visibility: 'room',
  selectiveUserIds: [],
  highlight: true,
  tagIds: [],
  documentIds: [],
};

/** Maps the wire shape to the app's `GlossaryEntry`. */
export function toGlossaryEntry(raw: RawGlossaryEntry): GlossaryEntry {
  return {
    id: raw.id,
    term: raw.term,
    aliases: raw.aliases,
    definition: raw.definition,
    visibility: raw.visibility,
    selectiveUserIds: raw.selective_user_ids,
    highlight: raw.highlight,
    tagIds: raw.tag_ids,
    documents: raw.documents,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    canEdit: raw.can_edit,
    canDelete: raw.can_delete,
  };
}

/** The request body for a create or an edit. */
export function toGlossaryBody(values: GlossaryFormValues) {
  return {
    term: values.term,
    aliases: values.aliases,
    definition: values.definition,
    visibility: values.visibility,
    selective_user_ids: values.visibility === 'selective' ? values.selectiveUserIds : [],
    highlight: values.highlight,
    tag_ids: values.tagIds,
    document_ids: values.documentIds,
  };
}

/** The form's values for an existing entry. */
export function glossaryFormValues(entry: GlossaryEntry): GlossaryFormValues {
  return {
    term: entry.term,
    aliases: entry.aliases,
    definition: entry.definition,
    visibility: entry.visibility,
    selectiveUserIds: entry.selectiveUserIds,
    highlight: entry.highlight,
    tagIds: entry.tagIds,
    documentIds: entry.documents.map((document) => document.id),
  };
}

/** Whether the form can be sent: a term, and a definition within its limit. */
export function canSubmitGlossary(values: GlossaryFormValues): boolean {
  return (
    values.term.trim().length > 0 &&
    values.term.length <= MAX_TERM_LENGTH &&
    values.definition.length <= MAX_DEFINITION_LENGTH
  );
}

/** The aliases typed as one comma- or line-separated string, as a list. */
export function parseAliases(typed: string): string[] {
  return typed
    .split(/[,\n]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

/** Lower case without accents: the same word whatever its spelling (backend `term_key`). */
export function termKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The letter an entry is listed under: its first letter without accents, or `#`. */
export function glossaryLetter(term: string): string {
  const first = termKey(term).charAt(0).toUpperCase();
  return /\p{L}/u.test(first) ? first : '#';
}

/** Entries grouped by letter, `#` first, each group by term; as the backend's order, accents ignored. */
export function groupByLetter(entries: GlossaryEntry[]): { letter: string; entries: GlossaryEntry[] }[] {
  const groups = new Map<string, GlossaryEntry[]>();
  const ordered = [...entries].sort((a, b) => termKey(a.term).localeCompare(termKey(b.term)));
  for (const entry of ordered) {
    const letter = glossaryLetter(entry.term);
    groups.set(letter, [...(groups.get(letter) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, entries: list }));
}

/** Entries matching a typed filter on the term or an alias, and carrying every picked Tag (FR-N4). */
export function filterGlossary(
  entries: GlossaryEntry[],
  filter: string,
  tagIds: string[],
): GlossaryEntry[] {
  const wanted = termKey(filter);
  return entries.filter(
    (entry) =>
      tagIds.every((tagId) => entry.tagIds.includes(tagId)) &&
      (wanted === '' ||
        [entry.term, ...entry.aliases].some((word) => termKey(word).includes(wanted))),
  );
}

/** A run of text, or a Glossary term found in it. */
export type GlossaryRun =
  | { kind: 'text'; text: string }
  | { kind: 'glossary'; text: string; entry: GlossaryEntry };

// A word is a run of letters and digits; a term is found only as whole words,
// and not right after `#` or `@`, which belong to a mention.
const WORD_PART = /[\p{L}\p{N}_]/u;

/** `text` without accents or capitals, and where each of its characters began in `text`. */
function normalizedWithOffsets(text: string): { plain: string; origin: number[] } {
  let plain = '';
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const bare = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const unit of bare) {
      plain += unit;
      for (let k = 0; k < unit.length; k++) origin.push(index);
    }
    index += char.length;
  }
  origin.push(index);
  return { plain, origin };
}

/**
 * Splits `text` into plain runs and Glossary terms (Decision 10): every
 * whole-word match of a term or alias of an entry that asks to be highlighted,
 * ignoring case and accents, the longest word winning where two overlap, and,
 * with `firstOnly`, only the first occurrence of each entry (Decision 12). `used`
 * holds the entries already found earlier in the same text and is added to.
 */
export function splitGlossaryTerms(
  text: string,
  entries: GlossaryEntry[],
  firstOnly = true,
  used: Set<string> = new Set(),
): GlossaryRun[] {
  const words: { key: string; entry: GlossaryEntry }[] = [];
  for (const entry of entries) {
    if (!entry.highlight) continue;
    for (const word of [entry.term, ...entry.aliases]) {
      const key = termKey(word);
      if (key) words.push({ key, entry });
    }
  }
  if (words.length === 0 || text === '') return [{ kind: 'text', text }];
  words.sort((a, b) => b.key.length - a.key.length);

  const { plain, origin } = normalizedWithOffsets(text);
  const found: { start: number; end: number; entry: GlossaryEntry }[] = [];
  let at = 0;
  while (at < plain.length) {
    const before = at === 0 ? '' : plain.charAt(at - 1);
    let hit: { key: string; entry: GlossaryEntry } | undefined;
    if (!WORD_PART.test(before) && before !== '#' && before !== '@') {
      hit = words.find(({ key, entry }) => {
        if (firstOnly && used.has(entry.id)) return false;
        if (!plain.startsWith(key, at)) return false;
        const after = plain.charAt(at + key.length);
        return after === '' || !WORD_PART.test(after);
      });
    }
    if (hit) {
      found.push({ start: origin[at]!, end: origin[at + hit.key.length]!, entry: hit.entry });
      used.add(hit.entry.id);
      at += hit.key.length;
    } else {
      at += 1;
    }
  }

  const runs: GlossaryRun[] = [];
  let cursor = 0;
  for (const { start, end, entry } of found) {
    if (start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, start) });
    runs.push({ kind: 'glossary', text: text.slice(start, end), entry });
    cursor = end;
  }
  if (cursor < text.length) runs.push({ kind: 'text', text: text.slice(cursor) });
  return runs;
}
