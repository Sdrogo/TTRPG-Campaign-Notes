import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { loadEmojiPicker } from '../../lib/emojiPicker';

class FakePicker {}

vi.mock('emoji-mart', () => ({ Picker: FakePicker }));
vi.mock('@emoji-mart/data', () => ({ default: { emojis: {} } }));
vi.mock('@emoji-mart/data/i18n/it.json', () => ({ default: { search: 'Cerca' } }));
vi.mock('@emoji-mart/data/i18n/en.json', () => ({ default: { search: 'Search' } }));
// Each other language's labels live in a file of emoji-mart's own (Portuguese is `pt`).
for (const file of ['de', 'es', 'fr', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'zh']) {
  vi.doMock(`@emoji-mart/data/i18n/${file}.json`, () => ({ default: { search: file } }));
}

describe('loadEmojiPicker', () => {
  // Spec 19c: the picker's labels follow the UI language.
  it('loads the picker, its data and the labels of the language asked for', async () => {
    expect(await loadEmojiPicker('it')).toEqual({
      Picker: FakePicker,
      data: { emojis: {} },
      i18n: { search: 'Cerca' },
    });
    expect((await loadEmojiPicker('en')).i18n).toEqual({ search: 'Search' });
  });

  it('has labels for every language the UI speaks', async () => {
    const searches = await Promise.all(
      SUPPORTED_LANGUAGES.map(async (language) => (await loadEmojiPicker(language)).i18n),
    );

    expect(searches).toEqual([
      { search: 'Cerca' },
      { search: 'Search' },
      { search: 'de' },
      { search: 'es' },
      { search: 'fr' },
      { search: 'ja' },
      { search: 'ko' },
      { search: 'nl' },
      { search: 'pl' },
      { search: 'pt' },
      { search: 'ru' },
      { search: 'zh' },
    ]);
  });
});
