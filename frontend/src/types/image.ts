// An uploaded image, as every API response returns it (Document and
// Comment images alike).
export interface StoredImage {
  id: string;
  url: string;
}

// An image chosen in a form but not uploaded yet: a local file, or a URL
// the backend will import.
export interface PendingImage {
  id: string;
  source: File | string;
  previewUrl: string;
  label: string;
}
