/** What a generated mention links to (spec 39): a Document or a Tag, as tokens name them. */
export type MentionSuggestionKind = 'doc' | 'tag';

/**
 * One proposed mention (spec 39): where the name sits in the stored text
 * (`start` inclusive, `end` exclusive), the words as written, what it would
 * link to and a little of the text around it as a reader sees it.
 */
export interface MentionSuggestion {
  start: number;
  end: number;
  text: string;
  kind: MentionSuggestionKind;
  targetId: string;
  targetName: string;
  before: string;
  after: string;
}

/** A description (`noteId` null) or a Note holding proposals. */
export interface MentionSuggestionSource {
  documentId: string;
  documentName: string;
  noteId: string | null;
  noteTitle: string | null;
  matches: MentionSuggestion[];
}

/** What applying wrote: how many mentions, in how many Documents. */
export interface AppliedMentionSuggestions {
  applied: number;
  documents: number;
}
