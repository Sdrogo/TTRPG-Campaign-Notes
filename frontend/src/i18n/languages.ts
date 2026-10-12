import deFlag from '../assets/flags/de.svg';
import esFlag from '../assets/flags/es.svg';
import frFlag from '../assets/flags/fr.svg';
import gbFlag from '../assets/flags/gb.svg';
import itFlag from '../assets/flags/it.svg';
import nlFlag from '../assets/flags/nl.svg';
import plFlag from '../assets/flags/pl.svg';
import ptFlag from '../assets/flags/pt.svg';
import ruFlag from '../assets/flags/ru.svg';
import type { Language } from '.';

/**
 * The flag the language selector shows for each language. Flags keep their
 * official colors: they're content, not theme, so the no-hardcoded-colors
 * rule (ui-context.md) doesn't apply to them — which is also why they are
 * image files rather than components. English uses the UK flag, Portuguese the Portuguese one (the file is `pt-PT`). Flags are simplified: no coats of arms.
 */
export const LANGUAGE_FLAGS: Record<Language, string> = {
  it: itFlag,
  en: gbFlag,
  de: deFlag,
  es: esFlag,
  fr: frFlag,
  nl: nlFlag,
  pl: plFlag,
  'pt-PT': ptFlag,
  ru: ruFlag,
};

/**
 * Each language's own name, for the selector's list: the other languages'
 * files aren't loaded until they are picked, so their `language.name` can't be
 * read there. A test keeps these equal to the files' `language.name`.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  it: 'Italiano',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  nl: 'Nederlands',
  pl: 'Polski',
  'pt-PT': 'Português',
  ru: 'Русский',
};

/** Languages shown with a "beta" label: translated by Claude and not yet read by a native speaker (spec 34, Decisions taken 1). */
export const BETA_LANGUAGES: readonly Language[] = ['de', 'es', 'fr', 'nl', 'pl', 'pt-PT', 'ru'];
