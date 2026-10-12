import type { Language } from '../i18n';

/** What the emoji picker needs, loaded on demand. */
export interface EmojiPickerModule {
  /** emoji-mart's `Picker`: builds the picker's custom element from its options. */
  Picker: new (options: Record<string, unknown>) => object;
  data: unknown;
  /** The picker's own labels in the UI language. */
  i18n: unknown;
}

/** emoji-mart's labels for each app language, one dynamic import each so only the one in use is fetched. */
const EMOJI_LABELS: Record<Language, () => Promise<{ default: unknown }>> = {
  de: () => import('@emoji-mart/data/i18n/de.json'),
  en: () => import('@emoji-mart/data/i18n/en.json'),
  es: () => import('@emoji-mart/data/i18n/es.json'),
  fr: () => import('@emoji-mart/data/i18n/fr.json'),
  it: () => import('@emoji-mart/data/i18n/it.json'),
  nl: () => import('@emoji-mart/data/i18n/nl.json'),
  pl: () => import('@emoji-mart/data/i18n/pl.json'),
  'pt-PT': () => import('@emoji-mart/data/i18n/pt.json'),
  ru: () => import('@emoji-mart/data/i18n/ru.json'),
};

/**
 * Loads emoji-mart, its emoji data and its labels for `language` (spec 19c).
 * Dynamic imports, so Vite splits them out of the main bundle: the data alone
 * is several hundred kB, and only someone opening the picker pays for it.
 */
export async function loadEmojiPicker(language: Language): Promise<EmojiPickerModule> {
  const [{ Picker }, data, labels] = await Promise.all([
    import('emoji-mart'),
    import('@emoji-mart/data'),
    EMOJI_LABELS[language](),
  ]);
  return { Picker, data: data.default, i18n: labels.default };
}
