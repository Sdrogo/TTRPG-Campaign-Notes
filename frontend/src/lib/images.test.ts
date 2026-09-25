import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGES_PER_COMMENT,
  imageFrameSize,
  imageOrientation,
  isHttpUrl,
  leadImage,
  pendingFromFile,
  pendingFromUrl,
  releasePendingImages,
  remainingImageSlots,
  toStoredImage,
} from './images';
import type { StoredImage } from '../types/image';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://example.com/a.png')).toBe(true);
    expect(isHttpUrl('http://example.com/a.png')).toBe(true);
    expect(isHttpUrl('ftp://example.com/a.png')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('remainingImageSlots', () => {
  it('counts existing minus removed plus pending against the limit', () => {
    expect(remainingImageSlots(0, 0, 0)).toBe(MAX_IMAGES_PER_COMMENT);
    expect(remainingImageSlots(2, 0, 1)).toBe(MAX_IMAGES_PER_COMMENT - 3);
    expect(remainingImageSlots(3, 2, 0)).toBe(MAX_IMAGES_PER_COMMENT - 1);
  });

  it('never goes negative', () => {
    expect(remainingImageSlots(4, 0, 3)).toBe(0);
  });
});

describe('pending images', () => {
  it('previews a URL as itself', () => {
    const pending = pendingFromUrl('https://example.com/map.png');
    expect(pending.previewUrl).toBe('https://example.com/map.png');
    expect(pending.source).toBe('https://example.com/map.png');
  });

  it('previews a file through an object URL and releases it', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const file = new File(['x'], 'map.png', { type: 'image/png' });

    const pending = pendingFromFile(file);
    expect(create).toHaveBeenCalledWith(file);
    expect(pending.previewUrl).toBe('blob:preview');
    expect(pending.label).toBe('map.png');

    releasePendingImages([pending, pendingFromUrl('https://example.com/x.png')]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });

  it('gives each pending image a distinct id', () => {
    expect(pendingFromUrl('https://a.test/1.png').id).not.toBe(pendingFromUrl('https://a.test/1.png').id);
  });
});


describe('toStoredImage', () => {
  it('reads the wire shape every image response uses', () => {
    expect(toStoredImage({ id: 'i1', url: 'https://x/a.webp', is_favorite: true })).toEqual({
      id: 'i1',
      url: 'https://x/a.webp',
      isFavorite: true,
    });
  });
});

describe('leadImage', () => {
  const image = (id: string, isFavorite: boolean): StoredImage => ({
    id,
    url: `https://x/${id}.webp`,
    isFavorite,
  });

  it('is the favorite, wherever it sits in the list', () => {
    expect(leadImage([image('a', false), image('b', true)])?.id).toBe('b');
  });

  it('falls back to the first image when the favorite is filtered out', () => {
    // A favorite attached to a Comment the viewer can't read never reaches
    // them, so their card leads with the first image they can see.
    expect(leadImage([image('a', false), image('b', false)])?.id).toBe('a');
  });

  it('is undefined for a Document with no images', () => {
    expect(leadImage([])).toBeUndefined();
  });
});

describe('imageOrientation', () => {
  it('frames a wider image as landscape', () => {
    expect(imageOrientation(1600, 900)).toBe('landscape');
  });

  it('frames a taller image as portrait', () => {
    expect(imageOrientation(900, 1600)).toBe('portrait');
  });

  it('frames a square image as landscape', () => {
    expect(imageOrientation(800, 800)).toBe('landscape');
  });
});

describe('imageFrameSize', () => {
  const cap = { base: 160, sm: 200 };

  it('fills the available width up to the cap for a landscape image', () => {
    expect(imageFrameSize('landscape', cap)).toEqual({ w: '100%', h: 'auto', mah: cap });
  });

  it('fills the cap height and keeps its own width for a portrait image', () => {
    expect(imageFrameSize('portrait', cap)).toEqual({ w: 'auto', h: cap });
  });

  it('holds a full-size placeholder before the image has loaded', () => {
    expect(imageFrameSize(null, cap)).toEqual({ w: '100%', h: cap, bg: 'var(--bg-base)' });
  });
});
