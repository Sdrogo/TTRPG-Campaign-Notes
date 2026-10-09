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

/**
 * Reads `text` aloud as `sourceId`, stopping whatever was playing. The voice
 * and speed are the ones chosen on the Account page for the app language
 * (spec 30 Decision 4), read at the start of each reading.
 */
export function playSpeech(sourceId: string, text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  const run = ++generation;
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
  const voice = pickVoice(synth.getVoices(), language, preferences);

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

  setState({ status: 'speaking', sourceId });
  speakChunk(0);
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
  if (!synth.speaking && !synth.pending) {
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
  window.speechSynthesis.cancel();
  setState(IDLE);
}
