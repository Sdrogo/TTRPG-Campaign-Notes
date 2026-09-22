import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGES_PER_COMMENT,
  isHttpUrl,
  pendingFromFile,
  pendingFromUrl,
  releasePendingImages,
  remainingImageSlots,
} from './images';

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
