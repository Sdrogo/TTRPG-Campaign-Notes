import type { DocumentVisibility } from './document';

/** A Document an entry links to (only ones the viewer sees). */
export interface GlossaryDocument {
  id: string;
  name: string;
}

/**
 * A Glossary entry (spec 79): a term with aliases and a definition, its own
 * visibility, Tags and linked Documents. The backend only sends the entries
 * the viewer may see.
 */
export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  /** Markdown with `#` mentions, like a Note. */
  definition: string;
  visibility: DocumentVisibility;
  /** Sent only to those who manage the Glossary; empty for a plain reader. */
  selectiveUserIds: string[];
  /** Whether the term is highlighted in texts (Decision 12). */
  highlight: boolean;
  tagIds: string[];
  documents: GlossaryDocument[];
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

/** The editable fields of an entry. */
export interface GlossaryFormValues {
  term: string;
  aliases: string[];
  definition: string;
  visibility: DocumentVisibility;
  selectiveUserIds: string[];
  highlight: boolean;
  tagIds: string[];
  documentIds: string[];
}

/** An entry as the backend sends it. */
export interface RawGlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
  visibility: DocumentVisibility;
  selective_user_ids: string[];
  highlight: boolean;
  tag_ids: string[];
  documents: GlossaryDocument[];
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}
