import { describe, expect, it, vi } from 'vitest';
import { loadEmojiPicker } from '../../lib/emojiPicker';

class FakePicker {}

vi.mock('emoji-mart', () => ({ Picker: FakePicker }));
vi.mock('@emoji-mart/data', () => ({ default: { emojis: {} } }));
vi.mock('@emoji-mart/data/i18n/it.json', () => ({ default: { search: 'Cerca' } }));
vi.mock('@emoji-mart/data/i18n/en.json', () => ({ default: { search: 'Search' } }));

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
});
