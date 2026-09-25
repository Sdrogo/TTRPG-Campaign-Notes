import { currentLanguage } from '../i18n';
import type { Document } from '../types/document';

/** How the Documents list orders its cards (spec 10's sorting control). */
export type DocumentSort = 'name-asc' | 'name-desc';

/** The sort applied when `?sort=` is absent from the URL. */
export const DEFAULT_SORT: DocumentSort = 'name-asc';

/** Orders `documents` by name in the UI's current language; `sort` picks
 *  ascending or descending. */
export function sortDocuments(documents: Document[], sort: DocumentSort): Document[] {
  const language = currentLanguage();
  const sorted = [...documents].sort((a, b) =>
    a.name.localeCompare(b.name, language, { sensitivity: 'base' }),
  );
  return sort === 'name-desc' ? sorted.reverse() : sorted;
}
