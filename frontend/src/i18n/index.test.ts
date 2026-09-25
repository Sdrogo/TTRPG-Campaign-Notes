import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY, currentLanguage, detectLanguage, setLanguage } from '.';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Spec 09: the browser's locale picks the language, until the user picks one
// from the flag selector.
describe('detectLanguage', () => {
  it('follows the browser locale, regional variants included', () => {
    expect(detectLanguage(['it-IT', 'en-US'])).toBe('it');
    expect(detectLanguage(['en-GB'])).toBe('en');
  });

  it('takes the first supported language among the browser preferences', () => {
    expect(detectLanguage(['de-DE', 'fr', 'it'])).toBe('it');
  });

  it('falls back to English when nothing the browser asks for is supported', () => {
    expect(detectLanguage(['de-DE', 'ja'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });

  it('prefers the language picked from the selector over the browser locale', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');

    expect(detectLanguage(['it-IT'])).toBe('en');
  });

  it('ignores a stored value that is not a supported language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');

    expect(detectLanguage(['it-IT'])).toBe('it');
  });

  it('still detects from the browser when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(detectLanguage(['it-IT'])).toBe('it');
  });
});

describe('setLanguage', () => {
  it('switches the UI, remembers the pick and updates <html lang>', async () => {
    await setLanguage('en');

    expect(currentLanguage()).toBe('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('still switches when the pick cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await setLanguage('en');

    expect(currentLanguage()).toBe('en');
  });
});
