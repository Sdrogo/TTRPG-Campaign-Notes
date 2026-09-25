import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';

// Every UI string lives in `locales/<code>.json` (spec 09). Adding a language
// is: a new JSON file with the same keys (`locales.test.ts` fails otherwise),
// an entry here and in `LANGUAGE_FLAGS` (`languages.ts`).

/** The languages the UI is translated into, in the order the selector lists them. */
export const SUPPORTED_LANGUAGES = ['it', 'en'] as const;

/** One of `SUPPORTED_LANGUAGES`. */
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Used when the browser asks for none of the supported languages. */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Where the language the user picked from the flag selector is remembered. */
export const LANGUAGE_STORAGE_KEY = 'ttrpg.language';

/** Whether `value` is one of `SUPPORTED_LANGUAGES`. */
export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

// Storage can throw (private mode, blocked site data); the language then
// just isn't remembered.
function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The language to start in: the one picked from the flag selector, else the
 * first of the browser's languages we support (`it-IT` counts as `it`), else
 * English. Only an explicit pick is stored, so until then the app keeps
 * following the browser's locale.
 */
export function detectLanguage(
  preferred: readonly string[] = navigator.languages ?? [navigator.language],
): Language {
  const stored = storedLanguage();
  if (stored) {
    return stored;
  }
  const match = preferred.map((tag) => tag.toLowerCase().split('-')[0]).find(isLanguage);
  return match ?? FALLBACK_LANGUAGE;
}

/** Switches the UI language and remembers the choice for the next visit. */
export async function setLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Not remembered; the switch itself still happens.
  }
  await i18n.changeLanguage(language);
}

/** The UI's current language. */
export function currentLanguage(): Language {
  return isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : FALLBACK_LANGUAGE;
}

// Screen readers and the browser's own spellcheck/hyphenation follow <html lang>.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources: { it: { translation: it }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // The resources are bundled, so there is nothing to wait for: the first
  // render already has its strings.
  initAsync: false,
  // React escapes what it renders already.
  interpolation: { escapeValue: false },
});

export default i18n;
