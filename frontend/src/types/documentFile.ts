/**
 * A PDF attached to a Document (spec 16, FR-D8). It has no visibility of its
 * own: whoever sees the Document sees its files (VR-12), so the backend sends
 * them only inside a Document the viewer can already read.
 */
export interface DocumentFile {
  id: string;
  documentId: string;
  /** The uploaded file's name, trimmed by the backend; the stored name is random. */
  name: string;
  sizeBytes: number;
  contentType: string;
  uploadedBy: string;
  createdAt: string;
  /**
   * A short-lived signed link served as `Content-Disposition: attachment`
   * (D-22): following it downloads the file, it never renders as a page.
   */
  url: string;
  /** Decided by the backend: the Document's Owners and the Master. */
  canDelete: boolean;
}
