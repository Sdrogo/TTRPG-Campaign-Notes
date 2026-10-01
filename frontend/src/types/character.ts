/**
 * A Character (D-23): a Document played by a member, as a Comment written as
 * it, or the composer's "Post as" picker, shows it. `imageUrl` is the
 * Document's leading image for this viewer, or null when it has none they may
 * see.
 */
export interface Character {
  documentId: string;
  name: string;
  imageUrl: string | null;
}
