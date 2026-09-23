/** An uploaded image, as every API response returns it (Document and Comment images alike). */
export interface StoredImage {
  id: string;
  url: string;
  /**
   * The one image that leads its Document: shown first in the gallery and on
   * the Document's card (spec 07). At most one per Document.
   */
  isFavorite: boolean;
}

/**
 * The same image as the API sends it. Kept apart from `StoredImage` so the
 * snake_case wire names are converted in exactly one place
 * (`lib/images.ts::toStoredImage`) rather than per hook.
 */
export interface RawImage {
  id: string;
  url: string;
  is_favorite: boolean;
}

/**
 * An image chosen in a form but not uploaded yet: a local file, or a URL the
 * backend will import.
 */
export interface PendingImage {
  id: string;
  source: File | string;
  previewUrl: string;
  label: string;
}
