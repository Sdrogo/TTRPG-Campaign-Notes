import { describe, expect, it } from 'vitest';
import it_ from '../../i18n/locales/it.json';
import { LANGUAGE_NAMES } from '../../i18n/languages';
import { flatten, problems, type Tree } from './localeCompare';

// `it.json` types every `t()` key at build time (`i18next.d.ts`); these
// tests hold the other languages to the same keys, placeholders and plural
// forms, so a key added only in Italian can't ship as a raw key path in
// another language (spec 09, 34).

const italian = flatten(it_);
// Every other file in the folder is held to the Italian one; its name is its
// language code (`pt-PT.json`).
const files = import.meta.glob<{ default: Tree }>('../../i18n/locales/*.json', { eager: true });
const others: Record<string, Tree> = Object.fromEntries(
  Object.entries(files)
    .map(([path, module]) => [path.split('/').pop()!.replace('.json', ''), module.default] as const)
    .filter(([language]) => language !== 'it'),
);

describe.each(Object.entries(others))('the %s resources', (language, tree) => {
  it('match the Italian file in keys, plural forms and placeholders, with no empty string', () => {
    expect(problems(language, flatten(tree), italian)).toEqual([]);
  });
});

describe('the language names', () => {
  it('match what each file calls its own language', () => {
    const names = Object.fromEntries(
      Object.entries({ ...others, it: it_ as Tree }).map(([language, tree]) => [
        language,
        (tree.language as Tree).name,
      ]),
    );

    expect(LANGUAGE_NAMES).toEqual(names);
  });
});

describe('the Italian resources', () => {
  it('leave no string empty', () => {
    expect([...italian].filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});
