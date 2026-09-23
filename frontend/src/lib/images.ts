import type { PendingImage } from '../types/image';

// Mirrors the backend's accepted formats (app/domain/images.py). The backend
// re-validates the actual bytes and scales large images down, so this is
// only a convenience filter for the file picker.
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

// Mirrors MAX_IMAGES_PER_COMMENT in app/domain/comments.py.
export const MAX_IMAGES_PER_COMMENT = 4;

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

// A file picked locally: previewed through an object URL until it's
// uploaded or discarded (call `releasePendingImages` then).
export function pendingFromFile(file: File): PendingImage {
  return { id: newPendingId(), source: file, previewUrl: URL.createObjectURL(file), label: file.name };
}

export function pendingFromUrl(url: string): PendingImage {
  return { id: newPendingId(), source: url, previewUrl: url, label: url };
}

export function releasePendingImages(images: PendingImage[]) {
  for (const image of images) {
    if (typeof image.source !== 'string') {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

// How many more images can be attached, given what's already there.
export function remainingImageSlots(
  existingCount: number,
  removedCount: number,
  pendingCount: number,
  max = MAX_IMAGES_PER_COMMENT,
): number {
  return Math.max(0, max - (existingCount - removedCount) - pendingCount);
}
