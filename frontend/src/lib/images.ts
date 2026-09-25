import type { PendingImage, RawImage, StoredImage } from '../types/image';

/**
 * Every API response returns images the same way (Document images, Comment
 * attachments), so they're read the same way too.
 */
export function toStoredImage(raw: RawImage): StoredImage {
  return { id: raw.id, url: raw.url, isFavorite: raw.is_favorite };
}

/**
 * The image a card leads with: the Document's favorite, which the backend
 * already sorts first. Falling back to the first image matters for a viewer
 * whose favorite is a Comment attachment they can't read - it's filtered out of
 * their response, so their card leads with whatever they can see.
 */
export function leadImage(images: StoredImage[]): StoredImage | undefined {
  return images.find((image) => image.isFavorite) ?? images[0];
}

/**
 * Mirrors the backend's accepted formats (app/domain/images.py). The backend
 * re-validates the actual bytes and scales large images down, so this is only a
 * convenience filter for the file picker.
 */
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

/** Mirrors MAX_IMAGES_PER_COMMENT in app/domain/comments.py. */
export const MAX_IMAGES_PER_COMMENT = 4;

/**
 * Whether `value` parses as an absolute http(s) URL - the only kind the backend
 * will import an image from.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

let nextPendingId = 0;
const newPendingId = () => `pending-${++nextPendingId}`;

/**
 * A file picked locally: previewed through an object URL until it's uploaded or
 * discarded (call `releasePendingImages` then).
 */
export function pendingFromFile(file: File): PendingImage {
  return { id: newPendingId(), source: file, previewUrl: URL.createObjectURL(file), label: file.name };
}

/** A URL to import on save. It is previewed directly from the remote host. */
export function pendingFromUrl(url: string): PendingImage {
  return { id: newPendingId(), source: url, previewUrl: url, label: url };
}

/** Frees the object URLs of pending local files. Call it once they're uploaded or discarded. */
export function releasePendingImages(images: PendingImage[]) {
  for (const image of images) {
    if (typeof image.source !== 'string') {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

/** How many more images can be attached, given what's already there. */
export function remainingImageSlots(
  existingCount: number,
  removedCount: number,
  pendingCount: number,
  max = MAX_IMAGES_PER_COMMENT,
): number {
  return Math.max(0, max - (existingCount - removedCount) - pendingCount);
}

/** How an image is framed on a Document card, from its natural size. */
export type ImageOrientation = 'landscape' | 'portrait';

/** Classify natural image dimensions in pixels for card framing. Images whose
 *  height is no greater than their width, including squares, are landscape. */
export function imageOrientation(width: number, height: number): ImageOrientation {
  return height > width ? 'portrait' : 'landscape';
}

/** The sizing an orientation-framed image is rendered with, within `maxHeight`. */
export interface ImageFrameSize {
  w: string;
  h: string | Record<string, number>;
  mah?: Record<string, number>;
  bg?: string;
}

/**
 * Frame an image by orientation (spec 07.1, reused for the Document detail
 * gallery by spec 10): a landscape image fills the available width up to
 * `maxHeight`, a portrait one fills the height and keeps its own width, and an
 * unloaded image (`orientation` still `null`) holds a full-size placeholder -
 * so nothing is stretched or cropped.
 */
export function imageFrameSize(
  orientation: ImageOrientation | null,
  maxHeight: Record<string, number>,
): ImageFrameSize {
  switch (orientation) {
    case 'landscape':
      return { w: '100%', h: 'auto', mah: maxHeight };
    case 'portrait':
      return { w: 'auto', h: maxHeight };
    case null:
      return { w: '100%', h: maxHeight, bg: 'var(--bg-base)' };
  }
}
