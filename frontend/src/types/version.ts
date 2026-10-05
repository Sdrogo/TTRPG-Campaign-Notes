/**
 * One saved state of a Document's name and description, or of a Note's title
 * and description (spec 24). `title` is the Document's name for a Document.
 * Only Owners and the Master ever receive these.
 */
export interface Version {
  id: string;
  title: string;
  /** The member who saved it, resolved through the Room's members. */
  editedBy: string;
  createdAt: string;
  /** The last save merged into this version (saves within 10 minutes merge). */
  updatedAt: string;
  /** Words added and removed against the version before; null for the first. */
  wordsAdded: number | null;
  wordsRemoved: number | null;
}

/** A version with its text, as the comparison needs it. */
export interface VersionDetail extends Version {
  description: string;
}
