// How `locales.test.ts` holds a language to the Italian file (spec 09, 34).
// Plurals are the reason it isn't a plain key comparison: i18next stores one
// string per plural category (`key_one`, `key_few`…), and each language has
// its own categories (Russian four, Japanese one), so a plural key is compared
// as a group.

export type Tree = { [key: string]: string | Tree };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Languages whose `many` category only covers large round numbers (1e6); a string for it is optional. */
const OPTIONAL_MANY = ['it', 'fr', 'es', 'pt', 'pt-PT', 'ca'];

/** Every leaf as `dotted.path -> text`. */
export function flatten(tree: Tree, prefix = ''): Map<string, string> {
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

export const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

/** Keys with their plural suffix removed, each mapped to the plural categories present (empty when not a plural). */
export function groupKeys(strings: Map<string, string>): Map<string, Map<string, string>> {
  const groups = new Map<string, Map<string, string>>();
  for (const [key, text] of strings) {
    const match = PLURAL_SUFFIX.exec(key);
    const base = match ? key.slice(0, match.index) : key;
    const category = match ? match[1] : '';
    const group = groups.get(base) ?? new Map<string, string>();
    group.set(category, text);
    groups.set(base, group);
  }
  return groups;
}

/** The plural categories a language needs a string for. */
export function requiredCategories(language: string): string[] {
  const all = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  return all.filter((category) => category !== 'many' || !OPTIONAL_MANY.includes(language));
}

/** What is wrong with `strings` next to the Italian `reference`; empty when it is fine. */
export function problems(
  language: string,
  strings: Map<string, string>,
  reference: Map<string, string>,
): string[] {
  const found: string[] = [];
  const own = groupKeys(strings);
  const expected = groupKeys(reference);
  const allowed = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const required = requiredCategories(language);

  for (const base of new Set([...own.keys(), ...expected.keys()])) {
    const ours = own.get(base);
    const theirs = expected.get(base);
    if (!ours) {
      found.push(`missing key ${base}`);
      continue;
    }
    if (!theirs) {
      found.push(`unknown key ${base}`);
      continue;
    }
    const isPlural = !theirs.has('');
    if (ours.has('') !== !isPlural) {
      found.push(`${base} is ${isPlural ? 'not ' : ''}a plural`);
      continue;
    }
    if (isPlural) {
      for (const category of required) {
        if (!ours.has(category)) {
          found.push(`${base} lacks the "${category}" form`);
        }
      }
      for (const category of ours.keys()) {
        if (!allowed.includes(category as Intl.LDMLPluralRule)) {
          found.push(`${base} has a "${category}" form ${language} doesn't use`);
        }
      }
    }
    // A plural form may leave `count` out ("Un commento"), so a group is
    // compared as a whole: nothing outside the reference's placeholders, and
    // every one of them used somewhere.
    const allowedNames = new Set([...theirs.values()].flatMap(placeholders));
    const usedNames = new Set([...ours.values()].flatMap(placeholders));
    const unknown = [...usedNames].filter((name) => !allowedNames.has(name));
    const unused = [...allowedNames].filter((name) => !usedNames.has(name));
    if (!isPlural) {
      if (
        JSON.stringify(placeholders(ours.get('') ?? '')) !==
        JSON.stringify(placeholders(theirs.get('') ?? ''))
      ) {
        found.push(`${base} changes the placeholders`);
      }
    } else if (unknown.length > 0 || unused.length > 0) {
      found.push(`${base} changes the placeholders`);
    }
    for (const [category, text] of ours) {
      if (text.trim() === '') {
        found.push(`${base}${category ? `_${category}` : ''} is empty`);
      }
    }
  }
  return found;
}
