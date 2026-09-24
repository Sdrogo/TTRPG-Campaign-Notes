import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import it_ from './locales/it.json';

// `it.json` types every `t()` key at build time (`i18next.d.ts`); these
// tests hold the other languages to the same set, so a key added only in
// Italian can't ship as a raw key path in English (spec 09).

type Tree = { [key: string]: string | Tree };

/** Every leaf as `dotted.path -> text`. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.set(path, value);
    } else {
      flatten(value, path).forEach((text, nested) => entries.set(nested, text));
    }
  }
  return entries;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const italian = flatten(it_);
const others = { en: flatten(en) };

describe.each(Object.entries(others))('the %s resources', (_language, strings) => {
  it('have exactly the keys the Italian file has', () => {
    expect([...strings.keys()].sort()).toEqual([...italian.keys()].sort());
  });

  it('use the same placeholders as Italian in every string', () => {
    for (const [key, text] of italian) {
      expect({ key, placeholders: placeholders(strings.get(key) ?? '') }).toEqual({
        key,
        placeholders: placeholders(text),
      });
    }
  });

  it('leave no string empty', () => {
    expect([...strings].filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});

describe('the Italian resources', () => {
  it('leave no string empty', () => {
    expect([...italian].filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});
