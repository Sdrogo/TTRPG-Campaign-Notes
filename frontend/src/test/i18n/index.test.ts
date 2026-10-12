import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, {
  LANGUAGE_STORAGE_KEY,
  currentLanguage,
  detectLanguage,
  ensureLanguageLoaded,
  loadStartingLanguage,
  resolveLanguage,
  startingLanguage,
  setLanguage,
} from '../../i18n';

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

// Spec 34: tags that don't name a language file as written. Only it and en
// exist today, so these run against a larger supported set.
describe('resolveLanguage', () => {
  const future = ['en', 'it', 'pt-PT', 'zh-Hans', 'ko'];
  const withTraditional = [...future, 'zh-Hant'];

  it.each([
    ['it-IT', future, 'it'],
    ['pt', future, 'pt-PT'],
    ['pt-BR', future, 'pt-PT'],
    ['pt-pt', future, 'pt-PT'],
    ['zh-CN', future, 'zh-Hans'],
    ['zh-Hans-CN', future, 'zh-Hans'],
    ['zh-TW', future, 'zh-Hans'],
    ['zh-Hant-HK', future, 'zh-Hans'],
    ['zh-TW', withTraditional, 'zh-Hant'],
    ['zh-Hant-HK', withTraditional, 'zh-Hant'],
    ['zh', withTraditional, 'zh-Hans'],
    ['KO-kr', future, 'ko'],
    ['fr-FR', future, undefined],
    ['*', future, undefined],
    ['', future, undefined],
  ])('reads %s as %s', (tag, supported, expected) => {
    expect(resolveLanguage(tag, supported)).toBe(expected);
  });

  it('knows no Portuguese or Chinese while those files do not exist', () => {
    expect(detectLanguage(['pt-BR', 'zh-TW'])).toBe('en');
  });
});

describe('ensureLanguageLoaded', () => {
  const strings = { language: { name: 'Test' } } as unknown as Parameters<
    typeof i18n.addResourceBundle
  >[2];

  afterEach(() => {
    i18n.removeResourceBundle('xx', 'translation');
  });

  it('fetches a language that is not loaded yet, once', async () => {
    const load = vi.fn().mockResolvedValue({ default: strings });

    await ensureLanguageLoaded('xx', { xx: load });
    await ensureLanguageLoaded('xx', { xx: load });

    expect(load).toHaveBeenCalledTimes(1);
    expect(i18n.hasResourceBundle('xx', 'translation')).toBe(true);
  });

  it('does nothing for a bundled language', async () => {
    await expect(ensureLanguageLoaded('it', {})).resolves.toBeUndefined();
  });

  it('rejects when the file cannot be fetched, and loads nothing', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(ensureLanguageLoaded('xx', { xx: load })).rejects.toThrow('offline');
    expect(i18n.hasResourceBundle('xx', 'translation')).toBe(false);
  });
});

describe('loadStartingLanguage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('it');
    i18n.removeResourceBundle('xx', 'translation');
  });

  it('does nothing for a bundled language', async () => {
    await loadStartingLanguage('en', {});

    expect(currentLanguage()).toBe('it');
  });

  it('fetches a language that is not bundled and switches to it', async () => {
    const strings = { language: { name: 'Test' } } as unknown as Parameters<
      typeof i18n.addResourceBundle
    >[2];

    await loadStartingLanguage('xx', { xx: () => Promise.resolve({ default: strings }) });

    expect(i18n.language).toBe('xx');
  });

  it('stays in the current language when the file cannot be fetched', async () => {
    await loadStartingLanguage('xx', { xx: () => Promise.reject(new Error('offline')) });

    expect(i18n.language).toBe('it');
  });
});

describe('startingLanguage', () => {
  it('starts in a bundled language, and in English while another one loads', () => {
    expect(startingLanguage('it')).toBe('it');
    expect(startingLanguage('ko')).toBe('en');
  });
});

describe('setLanguage with a slow language file', () => {
  it('lets the last pick win when an earlier fetch finishes after it', async () => {
    const strings = { language: { name: 'Test' } } as unknown as Parameters<
      typeof i18n.addResourceBundle
    >[2];
    let finish: (value: { default: typeof strings }) => void = () => {};
    const slow = new Promise<{ default: typeof strings }>((resolve) => {
      finish = resolve;
    });
    const first = setLanguage('xx' as 'it', { xx: () => slow });
    const second = setLanguage('en');
    await second;
    finish({ default: strings });
    await first;

    expect(currentLanguage()).toBe('en');
    expect(i18n.language).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    i18n.removeResourceBundle('xx', 'translation');
  });
});
