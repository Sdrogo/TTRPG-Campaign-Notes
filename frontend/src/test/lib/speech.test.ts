import { describe, expect, it } from 'vitest';
import {
  commentSpeech,
  DEFAULT_SPEECH_PREFERENCES,
  documentSpeech,
  mentionsToSpeech,
  noteSpeech,
  pickVoice,
  readSpeechPreferences,
  saveSpeechPreferences,
  speechChunks,
  speechSupported,
  voiceSpeaks,
} from '../../lib/speech';
import { installFakeSpeech } from '../speech';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('speechSupported', () => {
  it('is false without speech synthesis, true with it (spec 30 Decision 1)', () => {
    expect(speechSupported()).toBe(false);
    const { uninstall } = installFakeSpeech();
    expect(speechSupported()).toBe(true);
    uninstall();
    expect(speechSupported()).toBe(false);
  });
});

describe('mentionsToSpeech', () => {
  it('reads a mention as its name, never as the token (spec 30 Decision 2)', () => {
    expect(mentionsToSpeech(`Vedi #[La Torre](doc:${DOC_ID}) stanotte`)).toBe(
      'Vedi La Torre stanotte',
    );
  });

  it('reads member mentions only where asked, as in Comments', () => {
    const text = `Ciao @[Bea](user:${USER_ID})`;
    expect(mentionsToSpeech(text)).toBe(text);
    expect(mentionsToSpeech(text, { users: true })).toBe('Ciao Bea');
  });
});

describe('the text of a Document, a Note and a Comment', () => {
  const notes = [
    { title: 'Segreti', description: `Conosce #[Mira](doc:${DOC_ID}).` },
    { title: 'Vuota?', description: '' },
  ];

  it('reads a Note as its title, a pause, then its text', () => {
    expect(noteSpeech(notes[0])).toBe('Segreti.\n\nConosce Mira.');
    // A title already ending in punctuation gets no extra full stop.
    expect(noteSpeech(notes[1])).toBe('Vuota?');
  });

  it('reads a Document as its name, description, then each Note it carries in order', () => {
    expect(documentSpeech({ name: 'Mira', description: 'Una ladra.', notes })).toBe(
      'Mira.\n\nUna ladra.\n\nSegreti.\n\nConosce Mira.\n\nVuota?',
    );
  });

  it('reads a Comment under who wrote it, member mentions included', () => {
    expect(commentSpeech('Andrea ha scritto', `Grazie @[Bea](user:${USER_ID})`)).toBe(
      'Andrea ha scritto.\n\nGrazie Bea',
    );
  });
});

describe('speechChunks', () => {
  it('splits paragraphs and sentences into separate utterances (spec 30 Decision 5)', () => {
    expect(speechChunks('Prima frase. Seconda!\n\nAltro paragrafo\nriga')).toEqual([
      'Prima frase.',
      'Seconda!',
      'Altro paragrafo',
      'riga',
    ]);
  });

  it('cuts a long sentence after a comma, then at a space, never past the limit', () => {
    const chunks = speechChunks('uno due tre, quattro cinque sei sette otto', 20);
    expect(chunks).toEqual(['uno due tre,', 'quattro cinque sei', 'sette otto']);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
  });

  it('cuts a word longer than the limit hard', () => {
    expect(speechChunks('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('has nothing to say for blank text', () => {
    expect(speechChunks('  \n\n ')).toEqual([]);
  });
});

describe('speech preferences', () => {
  it('starts from the defaults and keeps what was saved', () => {
    expect(readSpeechPreferences()).toEqual(DEFAULT_SPEECH_PREFERENCES);
    saveSpeechPreferences({ voices: { it: 'voce-it' }, rate: 1.25 });
    expect(readSpeechPreferences()).toEqual({ voices: { it: 'voce-it' }, rate: 1.25 });
  });

  it('drops what it cannot read: an unknown language, an unoffered speed, bad JSON', () => {
    localStorage.setItem('ttrpg.speech', JSON.stringify({ voices: { fr: 'x', en: 3 }, rate: 9 }));
    expect(readSpeechPreferences()).toEqual(DEFAULT_SPEECH_PREFERENCES);
    localStorage.setItem('ttrpg.speech', '{');
    expect(readSpeechPreferences()).toEqual(DEFAULT_SPEECH_PREFERENCES);
  });
});

describe('voices', () => {
  const italian = { voiceURI: 'it-1', lang: 'it-IT' } as SpeechSynthesisVoice;
  const english = { voiceURI: 'en-1', lang: 'en_GB' } as SpeechSynthesisVoice;

  it('tells which voices speak the app language', () => {
    expect(voiceSpeaks(italian, 'it')).toBe(true);
    expect(voiceSpeaks(english, 'en')).toBe(true);
    expect(voiceSpeaks(english, 'it')).toBe(false);
  });

  it('uses the voice chosen for the app language while the browser still offers it', () => {
    const preferences = { voices: { it: 'it-1', en: 'gone' }, rate: 1 as const };
    expect(pickVoice([italian, english], 'it', preferences)).toBe(italian);
    // "Automatica": no choice, or a choice this browser no longer has.
    expect(pickVoice([italian, english], 'en', preferences)).toBeNull();
    expect(pickVoice([italian], 'it', DEFAULT_SPEECH_PREFERENCES)).toBeNull();
  });
});
