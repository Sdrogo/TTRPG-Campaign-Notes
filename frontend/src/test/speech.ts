import { vi } from 'vitest';

// A stand-in for the browser's speech synthesis (spec 30), which jsdom
// lacks: it records what was spoken and lets a test end utterances by hand.

/** An utterance as the fake records it. */
export class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

/** The fake `speechSynthesis`, with `finishCurrent` to end the utterance being spoken. */
export interface FakeSpeech {
  spoken: FakeUtterance[];
  voices: Partial<SpeechSynthesisVoice>[];
  speaking: boolean;
  pending: boolean;
  paused: boolean;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: () => Partial<SpeechSynthesisVoice>[];
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  finishCurrent: () => void;
  /** Lists `voices` and fires `voiceschanged`, as Chrome does once it has loaded them. */
  loadVoices: (voices: Partial<SpeechSynthesisVoice>[]) => void;
}

/** A voice for tests that don't care which one is used. */
export const DEFAULT_FAKE_VOICES: Partial<SpeechSynthesisVoice>[] = [
  { voiceURI: 'carla', name: 'Carla', lang: 'it-IT' },
];

/**
 * Installs the fake on `window` and returns it with an uninstall. The
 * returned fake speaks one utterance at a time: `finishCurrent` fires its
 * `onend`, which in the player queues the next one.
 */
export function installFakeSpeech(voices: Partial<SpeechSynthesisVoice>[] = DEFAULT_FAKE_VOICES): {
  speech: FakeSpeech;
  uninstall: () => void;
} {
  let current: FakeUtterance | null = null;
  const voicesChanged = new Set<() => void>();
  const speech: FakeSpeech = {
    spoken: [],
    voices,
    speaking: false,
    pending: false,
    paused: false,
    speak: vi.fn((utterance: FakeUtterance) => {
      speech.spoken.push(utterance);
      current = utterance;
      speech.speaking = true;
    }),
    cancel: vi.fn(() => {
      current = null;
      speech.speaking = false;
    }),
    pause: vi.fn(() => {
      speech.paused = true;
    }),
    resume: vi.fn(() => {
      speech.paused = false;
    }),
    getVoices: () => speech.voices,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      voicesChanged.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: () => void) => {
      voicesChanged.delete(listener);
    }),
    finishCurrent: () => {
      const done = current;
      current = null;
      speech.speaking = false;
      done?.onend?.();
    },
    loadVoices: (loaded) => {
      speech.voices = loaded;
      [...voicesChanged].forEach((listener) => listener());
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  return {
    speech,
    uninstall: () => {
      delete (window as { speechSynthesis?: unknown }).speechSynthesis;
      delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    },
  };
}
