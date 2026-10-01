import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY, currentLanguage, detectLanguage, setLanguage } from '../../i18n';

describe('currentLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // i18next can resolve to a language outside `SUPPORTED_LANGUAGES` (e.g. one
  // matched by `supportedLngs`'s own fallback logic); this app only ever
  // shows it or en, so that case still needs a safe value.
  it('falls back to English when i18next resolves to an unsupported language', () => {
    vi.spyOn(i18n, 'resolvedLanguage', 'get').mockReturnValue('fr');

    expect(currentLanguage()).toBe('en');
  });
});

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

  // No argument: falls through to the default parameter, which reads the
  // real navigator - the only way that expression itself runs.
  it('reads navigator.languages when called with no argument', () => {
    vi.stubGlobal('navigator', { ...navigator, languages: ['it-IT'], language: 'it-IT' });

    expect(detectLanguage()).toBe('it');
  });

  it('falls back to navigator.language when navigator.languages is unset', () => {
    vi.stubGlobal('navigator', { ...navigator, languages: undefined, language: 'it-IT' });

    expect(detectLanguage()).toBe('it');
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
