import { currentLanguage } from '../i18n';
import {
  pickVoice,
  readSpeechPreferences,
  SPEECH_LANGS,
  speechChunks,
  speechSupported,
} from './speech';

// The one read-aloud player (spec 30 Decision 3). `speechSynthesis` is a
// single queue per page, so a single player owns it: each control asks it to
// play its own text under its own `sourceId`, and reads back whether that
// source is the one playing.

/** Whether something is being read, and what. */
export interface SpeechState {
  status: 'idle' | 'speaking' | 'paused';
  /** The control's id for what is being read (`document:…`, `note:…`, `comment:…`), or null. */
  sourceId: string | null;
}

const IDLE: SpeechState = { status: 'idle', sourceId: null };

let state: SpeechState = IDLE;
// Bumped by every play and stop, so the callbacks of a cancelled reading
// (Chrome still fires `end`/`error` on them) don't move the new one along.
let generation = 0;
// Whether the current reading is still waiting for the voice list: nothing
// is queued yet, so a Resume then has to keep it rather than end it.
let waitingForVoices = false;
const listeners = new Set<() => void>();

function setState(next: SpeechState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** The current state; a stable object until it changes (for `useSyncExternalStore`). */
export function getSpeechState(): SpeechState {
  return state;
}

/** Calls `listener` on every state change; returns the unsubscribe. */
export function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// How long a first reading waits for the voice list before falling back to
// the browser's default voice.
export const VOICES_WAIT_MS = 1500;

/**
 * Asks the browser for its voices so they are loaded before the first
 * reading: Chrome only starts loading them on the first `getVoices()` call.
 */
export function primeSpeechVoices(): void {
  if (speechSupported()) window.speechSynthesis.getVoices();
}

// The voices once the browser has listed them, or whatever it has after
// `VOICES_WAIT_MS` (none, on a browser that never fires `voiceschanged`).
function waitForVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, VOICES_WAIT_MS);
    synth.addEventListener('voiceschanged', done);
  });
}

/**
 * Reads `text` aloud as `sourceId`, stopping whatever was playing. The voice
 * and speed are the ones chosen on the Account page for the app language
 * (spec 30 Decision 4, spec 30b), read at the start of each reading.
 *
 * Chrome lists no voices until it has loaded them, which it starts doing on
 * the first `getVoices()` call: the first reading of a page would then fall
 * back to the browser's default (low-quality) voice. So when the list is
 * still empty the reading waits for `voiceschanged` (at most
 * `VOICES_WAIT_MS`) before choosing; with the list already there it speaks
 * at once, still inside the click (iOS Safari needs that).
 */
export function playSpeech(sourceId: string, text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  const run = ++generation;
  waitingForVoices = false;
  synth.cancel();
  // Chrome keeps the queue paused across a cancel: a new reading started
  // while one was paused would otherwise stay silent.
  if (synth.paused) synth.resume();
  const chunks = speechChunks(text);
  if (chunks.length === 0) {
    setState(IDLE);
    return;
  }
  const language = currentLanguage();
  const preferences = readSpeechPreferences();

  const start = (voices: SpeechSynthesisVoice[]) => {
    const voice = pickVoice(voices, language, preferences);
    const speakChunk = (index: number) => {
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = voice?.lang ?? SPEECH_LANGS[language];
      if (voice) utterance.voice = voice;
      utterance.rate = preferences.rate;
      const next = () => {
        if (run !== generation) return;
        if (index + 1 < chunks.length) {
          speakChunk(index + 1);
        } else {
          setState(IDLE);
        }
      };
      utterance.onend = next;
      // A chunk the voice can't say is skipped rather than ending the reading;
      // a cancelled one is ignored above through `generation`.
      utterance.onerror = next;
      synth.speak(utterance);
    };
    speakChunk(0);
  };

  setState({ status: 'speaking', sourceId });
  const voices = synth.getVoices();
  if (voices.length > 0) {
    start(voices);
  } else {
    waitingForVoices = true;
    // Stopped or replaced while waiting: nothing to start. Paused while
    // waiting: the chunks queue on the paused synth and play on Resume.
    void waitForVoices(synth).then((loaded) => {
      if (run !== generation) return;
      waitingForVoices = false;
      start(loaded);
    });
  }
}

/** Pauses the reading; Resume carries on from there. */
export function pauseSpeech(): void {
  if (state.status !== 'speaking') return;
  window.speechSynthesis.pause();
  setState({ ...state, status: 'paused' });
}

/**
 * Resumes a paused reading. Some Android browsers end the reading on pause
 * (spec 30 Decision 6); with nothing left to resume, it goes back to idle.
 */
export function resumeSpeech(): void {
  if (state.status !== 'paused') return;
  const synth = window.speechSynthesis;
  if (!waitingForVoices && !synth.speaking && !synth.pending) {
    generation += 1;
    setState(IDLE);
    return;
  }
  synth.resume();
  setState({ ...state, status: 'speaking' });
}

/** Stops the reading, whatever is playing. */
export function stopSpeech(): void {
  if (state.status === 'idle') return;
  generation += 1;
  waitingForVoices = false;
  window.speechSynthesis.cancel();
  setState(IDLE);
}
