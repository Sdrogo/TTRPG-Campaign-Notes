import { describe, expect, it } from 'vitest';
import {
  commentSpeech,
  DEFAULT_SPEECH_PREFERENCES,
  documentSpeech,
  mentionsToSpeech,
  noteSpeech,
  pickVoice,
  rankVoices,
  readSpeechPreferences,
  saveSpeechPreferences,
  speechChunks,
  speechSupported,
  voiceScore,
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

  it('cuts hard when the only space falls just past the limit', () => {
    expect(speechChunks('abcd efgh', 4)).toEqual(['abcd', 'efgh']);
  });

  it('has nothing to say for blank text or bare punctuation', () => {
    expect(speechChunks('  \n\n ')).toEqual([]);
    expect(speechChunks('...')).toEqual([]);
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
    localStorage.setItem('ttrpg.speech', JSON.stringify({ voices: null, rate: 1.5 }));
    expect(readSpeechPreferences()).toEqual({ voices: {}, rate: 1.5 });
    localStorage.setItem('ttrpg.speech', '"testo"');
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
    // "Automatica": no choice, or a choice this browser no longer has, uses
    // the best voice for the language (spec 30b), else leaves it to the browser.
    expect(pickVoice([italian, english], 'en', preferences)).toBe(english);
    expect(pickVoice([italian], 'it', DEFAULT_SPEECH_PREFERENCES)).toBe(italian);
    expect(pickVoice([italian], 'en', DEFAULT_SPEECH_PREFERENCES)).toBeNull();
  });
});

describe('ranking voices (spec 30b)', () => {
  const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
    ({
      voiceURI: name,
      name,
      lang,
      localService: true,
      default: false,
      ...extra,
    }) as SpeechSynthesisVoice;

  it('puts neural and network voices before the system ones, novelty and robotic voices last', () => {
    const elsa = voice('Microsoft Elsa - Italian (Italy)', 'it-IT', { default: true });
    const isabella = voice('Microsoft Isabella Online (Natural) - Italian (Italy)', 'it-IT', {
      localService: false,
    });
    const google = voice('Google italiano', 'it-IT', { localService: false });
    const federica = voice('Federica (Premium)', 'it-IT');
    const grandma = voice('Grandma (Italian (Italy))', 'it-IT');
    const espeak = voice('eSpeak Italian', 'it');
    const daniel = voice('Daniel', 'en-GB');

    expect(rankVoices([grandma, elsa, espeak, federica, daniel, google, isabella], 'it')).toEqual([
      google,
      isabella,
      federica,
      elsa,
      grandma,
      espeak,
    ]);
  });

  it('prefers the main region, then the browser default, then keeps the browser order', () => {
    const swiss = voice('Luca', 'it-CH');
    const italy = voice('Alice', 'it_IT');
    const other = voice('Paola', 'it-IT');
    const defaultOne = voice('Carla', 'it-IT', { default: true });
    expect(voiceScore(italy, 'it')).toBeGreaterThan(voiceScore(swiss, 'it'));
    expect(rankVoices([swiss, italy, other, defaultOne], 'it')).toEqual([
      defaultOne,
      italy,
      other,
      swiss,
    ]);
  });
});
