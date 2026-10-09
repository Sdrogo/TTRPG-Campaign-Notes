import { useEffect, useSyncExternalStore } from 'react';
import {
  getSpeechState,
  pauseSpeech,
  playSpeech,
  resumeSpeech,
  stopSpeech,
  subscribeSpeech,
} from '../lib/speechPlayer';

/** The read-aloud state of one source and the actions on it. */
export interface ReadAloud {
  /** What this source is doing: idle also while another source plays. */
  status: 'idle' | 'speaking' | 'paused';
  /** Reads the text aloud, stopping whatever else was playing. */
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * Read aloud for one source (spec 30 Decision 3): a Document, a Note or a
 * Comment, identified by `sourceId`. `getText` is called only on play, so the
 * text is built from what is on screen at that moment.
 */
export function useReadAloud(sourceId: string, getText: () => string): ReadAloud {
  const state = useSyncExternalStore(subscribeSpeech, getSpeechState);
  return {
    status: state.sourceId === sourceId ? state.status : 'idle',
    play: () => playSpeech(sourceId, getText()),
    pause: pauseSpeech,
    resume: resumeSpeech,
    stop: stopSpeech,
  };
}

/** Stops any reading when the calling page unmounts (spec 30 Decision 3: leaving the page stops it). */
export function useStopReadingOnLeave(): void {
  useEffect(() => stopSpeech, []);
}
