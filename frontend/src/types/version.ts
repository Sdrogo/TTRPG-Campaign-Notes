/**
 * One revision of a whole Document (spec 24b): its name, its description and
 * its Notes as they were after a save. `title` is the Document's name. Only
 * Owners and the Master ever receive these, already limited to the Notes they
 * may see.
 */
export interface Version {
  id: string;
  title: string;
  /** The member who saved it, resolved through the Room's members. */
  editedBy: string;
  createdAt: string;
  /** The last save merged into this revision (saves within 10 minutes merge). */
  updatedAt: string;
  /** Words added and removed against the revision before; null for the first. */
  wordsAdded: number | null;
  wordsRemoved: number | null;
  /** Notes added and removed against the revision before; null for the first. */
  notesAdded: number | null;
  notesRemoved: number | null;
}

/** A Note as a revision holds it. */
export interface VersionNote {
  id: string;
  title: string;
  description: string;
}

/** A revision with its texts, as the comparison needs it. */
export interface VersionDetail extends Version {
  description: string;
  /** The Notes in display order. */
  notes: VersionNote[];
}
