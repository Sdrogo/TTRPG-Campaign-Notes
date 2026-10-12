import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
import it_ from '../../i18n/locales/it.json';
import { flatten, problems, type Tree } from './localeCompare';

// `it.json` types every `t()` key at build time (`i18next.d.ts`); these
// tests hold the other languages to the same keys, placeholders and plural
// forms, so a key added only in Italian can't ship as a raw key path in
// another language (spec 09, 34).

const italian = flatten(it_);
const others: Record<string, Tree> = { en };

describe.each(Object.entries(others))('the %s resources', (language, tree) => {
  it('match the Italian file in keys, plural forms and placeholders, with no empty string', () => {
    expect(problems(language, flatten(tree), italian)).toEqual([]);
  });
});

describe('the Italian resources', () => {
  it('leave no string empty', () => {
    expect([...italian].filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});
