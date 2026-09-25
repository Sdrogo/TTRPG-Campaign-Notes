import gbFlag from '../assets/flags/gb.svg';
import itFlag from '../assets/flags/it.svg';
import type { Language } from '.';

/**
 * The flag the language selector shows for each language. Flags keep their
 * official colors: they're content, not theme, so the no-hardcoded-colors
 * rule (ui-context.md) doesn't apply to them — which is also why they are
 * image files rather than components. English uses the UK flag.
 */
export const LANGUAGE_FLAGS: Record<Language, string> = {
  it: itFlag,
  en: gbFlag,
};
