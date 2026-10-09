import { isLanguage, type Language } from '../i18n';
import type { Document } from '../types/document';
import type { Note } from '../types/note';
import { splitMentionTokens, type TokenOptions } from './mentionTokens';

// Read aloud (spec 30): the browser's own speech synthesis, nothing on the
// server. These helpers stay free of `speechSynthesis` calls (except
// `speechSupported`) so they can be tested as plain functions; playing
// lives in `speechPlayer.ts`.

/** The longest chunk handed to one utterance (spec 30 Decision 5). */
export const MAX_SPEECH_CHUNK = 200;

/** The speeds offered on the Account page (spec 30 Decision 4). */
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5] as const;

/** One of `SPEECH_RATES`. */
export type SpeechRate = (typeof SPEECH_RATES)[number];

/** The BCP 47 tag an utterance is spoken in, for each app language. */
export const SPEECH_LANGS: Record<Language, string> = { it: 'it-IT', en: 'en-US' };

/** Whether this browser can read aloud; without it every control is hidden (spec 30 Decision 1). */
export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/**
 * Stored text as it should be heard: every mention token read as its name,
 * without the `#`/`@` sigil (spec 30 Decision 2).
 */
export function mentionsToSpeech(text: string, options: TokenOptions = {}): string {
  return splitMentionTokens(text, options)
    .map((segment) => (segment.kind === 'text' ? segment.stored : segment.name))
    .join('');
}

// A heading followed by its text: a full stop after the heading makes the
// voice pause there, unless it already ends in punctuation.
function headed(title: string, text: string, options: TokenOptions = {}): string {
  const heading = title.trim();
  const body = mentionsToSpeech(text, options).trim();
  const spokenHeading = heading && !/[.!?:;]$/.test(heading) ? `${heading}.` : heading;
  return [spokenHeading, body].filter(Boolean).join('\n\n');
}

/** What reading one Note says: its title, then its text. */
export function noteSpeech(note: Pick<Note, 'title' | 'description'>): string {
  return headed(note.title, note.description);
}

/**
 * What reading a whole Document says: its name and description, then each
 * Note the viewer sees, in order (spec 30 Decision 2). The backend already
 * left out what the viewer may not see.
 */
export function documentSpeech(
  document: Pick<Document, 'name' | 'description'> & {
    notes: Pick<Note, 'title' | 'description'>[];
  },
): string {
  return [headed(document.name, document.description), ...document.notes.map(noteSpeech)]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What reading one Comment says: `heading` (who wrote it, e.g. "Andrea ha
 * scritto"), then its text with member mentions read as names too.
 */
export function commentSpeech(heading: string, body: string): string {
  return headed(heading, body, { users: true });
}

// `text` cut into pieces of at most `max` characters at the last match of
// `separator` that fits. Where none fits, `hard` cuts at `max`; otherwise the
// rest is left whole for a finer separator to cut.
function splitBy(text: string, separator: RegExp, max: number, hard: boolean): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    for (const match of window.matchAll(separator)) {
      const end = match.index + match[0].length;
      if (end <= max) cut = end;
    }
    if (cut <= 0) {
      if (!hard) break;
      cut = max;
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  pieces.push(rest);
  return pieces.filter(Boolean);
}

/**
 * `text` as the utterances to speak in order (spec 30 Decision 5): one per
 * paragraph and sentence, a long sentence cut after a comma or, failing
 * that, a space, none longer than `max`. Chrome stops a single long
 * utterance after about 15 seconds, and short ones let Stop act at once.
 */
export function speechChunks(text: string, max: number = MAX_SPEECH_CHUNK): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n\s*\n|\n/)) {
    const sentences = paragraph.match(/[^.!?…]+(?:[.!?…]+["'»”)\]]*|$)/g) ?? [];
    for (const raw of sentences) {
      const sentence = raw.replace(/\s+/g, ' ').trim();
      if (!sentence) continue;
      for (const piece of splitBy(sentence, /[,;:]\s/g, max, false)) {
        chunks.push(...splitBy(piece, /\s/g, max, true));
      }
    }
  }
  return chunks;
}

/** The read-aloud choices on this device (spec 30 Decision 4). */
export interface SpeechPreferences {
  /** The chosen voice's `voiceURI` for each app language; missing = "Automatica". */
  voices: Partial<Record<Language, string>>;
  rate: SpeechRate;
}

/** The choices before any is made: the browser's default voice, normal speed. */
export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = { voices: {}, rate: 1 };

const PREFERENCES_KEY = 'ttrpg.speech';

function isRate(value: unknown): value is SpeechRate {
  return SPEECH_RATES.includes(value as SpeechRate);
}

/**
 * The read-aloud choices stored on this device, or the defaults. Storage can
 * be unavailable or hold something else (private window, an older shape), so
 * anything unreadable falls back to the defaults.
 */
export function readSpeechPreferences(): SpeechPreferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULT_SPEECH_PREFERENCES;
    const { voices, rate } = stored as { voices?: unknown; rate?: unknown };
    const keptVoices: SpeechPreferences['voices'] = {};
    if (typeof voices === 'object' && voices !== null) {
      for (const [language, uri] of Object.entries(voices)) {
        if (isLanguage(language) && typeof uri === 'string') {
          keptVoices[language] = uri;
        }
      }
    }
    return { voices: keptVoices, rate: isRate(rate) ? rate : 1 };
  } catch {
    return DEFAULT_SPEECH_PREFERENCES;
  }
}

/** Remembers the read-aloud choices on this device; a no-op when storage is unavailable. */
export function saveSpeechPreferences(preferences: SpeechPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Nothing to do: the next reading uses the defaults.
  }
}

/** Whether `voice` speaks the app language (`it-IT`, `it_IT` and `it` all count as `it`). */
export function voiceSpeaks(
  voice: Pick<SpeechSynthesisVoice, 'lang'>,
  language: Language,
): boolean {
  return voice.lang.toLowerCase().replace('_', '-').split('-')[0] === language;
}

// Names that mark a neural or high-quality voice: Edge's "Online (Natural)",
// Chrome's network "Google …" voices, Apple's downloadable "Enhanced" and
// "Premium" ones (spec 30b).
const GOOD_VOICE = /natural|neural|online|enhanced|premium|wavenet|siri|google/i;

// Robotic engines and Apple's novelty voices, which some browsers list under
// every language (spec 30b).
const POOR_VOICE =
  /espeak|compact|eloquence|\b(albert|bad news|bahh|bells|boing|bubbles|cellos|eddy|flo|fred|good news|grandma|grandpa|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox)\b/i;

/**
 * How good `voice` is likely to sound, higher is better (spec 30b): a
 * neural-sounding name counts most, then being a network voice (they are
 * usually neural), then speaking the app language's main region (`it-IT`
 * over `it-CH`), then being the browser's default. The browser exposes no
 * quality flag, so this is a heuristic over names.
 */
export function voiceScore(
  voice: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>,
  language: Language,
): number {
  let score = 0;
  if (GOOD_VOICE.test(voice.name)) score += 8;
  if (POOR_VOICE.test(voice.name)) score -= 8;
  if (!voice.localService) score += 4;
  if (voice.lang.replace('_', '-').toLowerCase() === SPEECH_LANGS[language].toLowerCase())
    score += 2;
  if (voice.default) score += 1;
  return score;
}

/** The voices that speak the app language, best first (`voiceScore`); ties keep the browser's order. */
export function rankVoices(
  voices: SpeechSynthesisVoice[],
  language: Language,
): SpeechSynthesisVoice[] {
  return voices
    .filter((voice) => voiceSpeaks(voice, language))
    .map((voice, index) => ({ voice, index, score: voiceScore(voice, language) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ voice }) => voice);
}

/**
 * The voice to read in: the one chosen for the app language when this
 * browser still has it, else the best one it has for that language
 * ("Automatica", spec 30b), else null, which leaves the choice to the
 * browser for the utterance's `lang`.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  language: Language,
  preferences: SpeechPreferences,
): SpeechSynthesisVoice | null {
  const chosen = preferences.voices[language];
  return (
    (chosen && voices.find((voice) => voice.voiceURI === chosen)) ||
    rankVoices(voices, language)[0] ||
    null
  );
}
