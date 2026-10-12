import { describe, expect, it } from 'vitest';
import { flatten, problems, requiredCategories } from './localeCompare';

const italian = flatten({
  title: 'Titolo',
  greeting: 'Ciao {{name}}',
  unread_one: '{{count}} nuovo',
  unread_other: '{{count}} nuovi',
});

describe('requiredCategories', () => {
  it('follows each language, leaving out the optional "many"', () => {
    expect(requiredCategories('ru').sort()).toEqual(['few', 'many', 'one', 'other']);
    expect(requiredCategories('ja')).toEqual(['other']);
    expect(requiredCategories('it').sort()).toEqual(['one', 'other']);
  });
});

describe('problems', () => {
  it('accepts a language with its own plural forms', () => {
    const russian = flatten({
      title: 'Заголовок',
      greeting: 'Привет, {{name}}',
      unread_one: '{{count}} новый',
      unread_few: '{{count}} новых',
      unread_many: '{{count}} новых',
      unread_other: '{{count}} новых',
    });

    expect(problems('ru', russian, italian)).toEqual([]);
  });

  it('accepts a language with a single plural form', () => {
    const japanese = flatten({
      title: 'タイトル',
      greeting: 'こんにちは、{{name}}',
      unread_other: '新着 {{count}} 件',
    });

    expect(problems('ja', japanese, italian)).toEqual([]);
  });

  it('accepts a plural form that leaves the count out', () => {
    const english = flatten({
      title: 'Title',
      greeting: 'Hi {{name}}',
      unread_one: 'One new',
      unread_other: '{{count}} new',
    });

    expect(problems('en', english, italian)).toEqual([]);
  });

  it('reports a missing plural form, a form the language lacks, and a missing key', () => {
    const wrong = flatten({
      title: 'Title',
      greeting: 'Hi {{name}}',
      unread_one: '{{count}} new',
      unread_few: '{{count}} new',
    });

    expect(problems('en', wrong, italian)).toEqual([
      'unread lacks the "other" form',
      'unread has a "few" form en doesn\'t use',
    ]);
    expect(problems('en', flatten({ title: 'Title' }), italian)).toContain('missing key greeting');
  });

  it('reports changed placeholders, unknown keys and empty strings', () => {
    const wrong = flatten({
      title: ' ',
      greeting: 'Hi {{user}}',
      extra: 'x',
      unread_one: '{{count}} new',
      unread_other: '{{n}} new',
    });

    expect(problems('en', wrong, italian)).toEqual([
      'title is empty',
      'greeting changes the placeholders',
      'unknown key extra',
      'unread changes the placeholders',
    ]);
  });
});
