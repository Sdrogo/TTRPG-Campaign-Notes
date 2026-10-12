import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';

// Every UI string lives in `locales/<code>.json` (spec 09). Adding a language
// is: a new JSON file with the same keys (`locales.test.ts` fails otherwise),
// an entry in `SUPPORTED_LANGUAGES` and `LAZY_LOADERS` here, and one in
// `LANGUAGE_FLAGS` (`languages.ts`). Italian and English are bundled; every
// other language is fetched when it is first needed (spec 34).

/** The languages the UI is translated into, in the order the selector lists them. */
export const SUPPORTED_LANGUAGES = [
  'it',
  'en',
  'de',
  'es',
  'fr',
  'nl',
  'pl',
  'pt-PT',
  'ru',
] as const;

/** One of `SUPPORTED_LANGUAGES`. */
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Used when the browser asks for none of the supported languages. */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Where the language the user picked from the flag selector is remembered. */
export const LANGUAGE_STORAGE_KEY = 'ttrpg.language';

/**
 * Browser tags that don't name a language file as written (spec 34). A bare
 * `pt` is European Portuguese, mainland and Simplified-script Chinese tags are
 * `zh-Hans` and Traditional ones `zh-Hant`. An alias counts only when its
 * target is supported, so `zh-TW` reads Simplified until `zh-Hant` exists.
 * Keys are lower case; `backend/app/i18n/translator.py` keeps the same table.
 */
export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  pt: 'pt-PT',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
};

/**
 * The supported language a browser language tag (`pt-BR`, `zh-Hant-HK`,
 * `it-IT`) means, or undefined. The tag is tried whole, then with its last
 * subtag dropped again and again; at each step an alias or a case-insensitive
 * match of a language code wins.
 */
export function resolveLanguage(
  tag: string,
  supported: readonly string[] = SUPPORTED_LANGUAGES,
): string | undefined {
  const parts = tag.trim().toLowerCase().split('-');
  while (parts.length > 0 && parts[0] !== '') {
    const candidate = parts.join('-');
    const target = LANGUAGE_ALIASES[candidate];
    if (target && supported.includes(target)) {
      return target;
    }
    const exact = supported.find((code) => code.toLowerCase() === candidate);
    if (exact) {
      return exact;
    }
    parts.pop();
  }
  return undefined;
}

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
  const match = preferred.map((tag) => resolveLanguage(tag)).find(isLanguage);
  return match ?? FALLBACK_LANGUAGE;
}

type Resources = { [key: string]: unknown };

/**
 * The languages that are not bundled, each a dynamic `import()` so Vite
 * splits its file out of the main bundle (spec 34). Empty until the first
 * new language lands.
 */
const LAZY_LOADERS: Readonly<Record<string, () => Promise<{ default: Resources }>>> = {
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  nl: () => import('./locales/nl.json'),
  pl: () => import('./locales/pl.json'),
  'pt-PT': () => import('./locales/pt-PT.json'),
  ru: () => import('./locales/ru.json'),
};

/**
 * Makes sure `language`'s strings are in i18next: nothing to do for a bundled
 * language or one already fetched; otherwise it fetches the file. Rejects when
 * the fetch fails, leaving the current language as it was.
 */
export async function ensureLanguageLoaded(
  language: string,
  loaders: Readonly<Record<string, () => Promise<{ default: Resources }>>> = LAZY_LOADERS,
): Promise<void> {
  const load = loaders[language];
  if (!load || i18n.hasResourceBundle(language, 'translation')) {
    return;
  }
  const { default: strings } = await load();
  i18n.addResourceBundle(language, 'translation', strings);
}

/** The newest `setLanguage` call, so a slow fetch can't overwrite a later pick. */
let latestSwitch = 0;

/**
 * Switches the UI language and remembers the choice for the next visit. The
 * language's file is fetched first, so a failed fetch rejects and changes
 * nothing.
 */
export async function setLanguage(
  language: Language,
  loaders: Readonly<Record<string, () => Promise<{ default: Resources }>>> = LAZY_LOADERS,
): Promise<void> {
  const request = ++latestSwitch;
  await ensureLanguageLoaded(language, loaders);
  if (request !== latestSwitch) {
    // A later pick started while this file was loading; that one wins.
    return;
  }
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

const initialLanguage = detectLanguage();
const bundled: Record<string, Resources> = { it, en };

/** The language i18next starts in: `language` when it is bundled, else the fallback until its file is in. */
export function startingLanguage(language: string): string {
  return language in bundled ? language : FALLBACK_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: { it: { translation: it }, en: { translation: en } },
  // A language that isn't bundled switches once its file is in (`i18nReady`).
  lng: startingLanguage(initialLanguage),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // The resources are bundled, so there is nothing to wait for: the first
  // render already has its strings.
  initAsync: false,
  // React escapes what it renders already.
  interpolation: { escapeValue: false },
});

/**
 * Brings the starting language in: nothing for a bundled one; otherwise it
 * fetches the file and switches to it. If the file can't be fetched the app
 * stays in the fallback.
 */
export async function loadStartingLanguage(
  language: string,
  loaders: Readonly<Record<string, () => Promise<{ default: Resources }>>> = LAZY_LOADERS,
): Promise<void> {
  if (language in bundled) {
    return;
  }
  try {
    await ensureLanguageLoaded(language, loaders);
    await i18n.changeLanguage(language);
  } catch {
    // Offline or the file is gone: English still works.
  }
}

/**
 * Resolves once the starting language's strings are loaded, so `main.tsx` can
 * hold the first render for a language that isn't bundled and nothing flashes
 * in the wrong one.
 */
export const i18nReady: Promise<void> = loadStartingLanguage(initialLanguage);

export default i18n;
