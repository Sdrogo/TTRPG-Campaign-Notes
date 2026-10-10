import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSpeechState,
  pauseSpeech,
  playSpeech,
  primeSpeechVoices,
  resumeSpeech,
  stopSpeech,
  subscribeSpeech,
  VOICES_WAIT_MS,
} from '../../lib/speechPlayer';
import { saveSpeechPreferences } from '../../lib/speech';
import { setLanguage } from '../../i18n';
import { installFakeSpeech, type FakeSpeech } from '../speech';

let speech: FakeSpeech;
let uninstall: () => void;

beforeEach(() => {
  ({ speech, uninstall } = installFakeSpeech([
    { voiceURI: 'alice', name: 'Alice', lang: 'it-IT' },
  ]));
});

afterEach(() => {
  stopSpeech();
  uninstall();
});

describe('the read-aloud player (spec 30)', () => {
  it('speaks the chunks one after the other, then goes idle', () => {
    playSpeech('note:1', 'Prima. Seconda.');
    expect(getSpeechState()).toEqual({ status: 'speaking', sourceId: 'note:1' });
    expect(speech.spoken.map((u) => u.text)).toEqual(['Prima.']);
    speech.finishCurrent();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Prima.', 'Seconda.']);
    speech.finishCurrent();
    expect(getSpeechState()).toEqual({ status: 'idle', sourceId: null });
  });

  it('speaks in the app language, with the voice and speed chosen for it (Decision 4)', async () => {
    // "Automatica": the best Italian voice installed (spec 30b).
    playSpeech('note:1', 'Ciao.');
    expect(speech.spoken[0]).toMatchObject({ lang: 'it-IT', rate: 1 });
    expect(speech.spoken[0].voice).toMatchObject({ voiceURI: 'alice' });

    saveSpeechPreferences({ voices: { it: 'alice' }, rate: 1.5 });
    playSpeech('note:1', 'Ciao.');
    expect(speech.spoken[1]).toMatchObject({ lang: 'it-IT', rate: 1.5 });
    expect(speech.spoken[1].voice).toMatchObject({ voiceURI: 'alice' });

    await setLanguage('en');
    playSpeech('note:1', 'Hello.');
    // No English voice installed: the browser's default for en-US.
    expect(speech.spoken[2]).toMatchObject({ lang: 'en-US', voice: null });
  });

  it('plays one thing at a time: a new reading cancels the old one, whose end is ignored', () => {
    playSpeech('note:1', 'Uno. Due.');
    const old = speech.spoken[0];
    playSpeech('comment:2', 'Tre.');
    expect(speech.cancel).toHaveBeenCalled();
    expect(getSpeechState().sourceId).toBe('comment:2');
    // Chrome still fires the cancelled utterance's end: it must not queue "Due.".
    old.onend?.();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Uno.', 'Tre.']);
  });

  it('pauses, resumes and stops, telling subscribers each time', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeSpeech(() => seen.push(getSpeechState().status));
    playSpeech('document:1', 'Testo lungo. Ancora.');
    pauseSpeech();
    expect(speech.pause).toHaveBeenCalled();
    resumeSpeech();
    expect(speech.resume).toHaveBeenCalled();
    stopSpeech();
    unsubscribe();
    expect(seen).toEqual(['speaking', 'paused', 'speaking', 'idle']);
    // Stopped: a late end from the cancelled utterance changes nothing.
    speech.spoken[0].onend?.();
    expect(speech.spoken).toHaveLength(1);
  });

  it('goes idle on resume when the browser already ended the reading (Decision 6)', () => {
    playSpeech('document:1', 'Testo.');
    pauseSpeech();
    speech.speaking = false;
    resumeSpeech();
    expect(getSpeechState()).toEqual({ status: 'idle', sourceId: null });
    expect(speech.resume).not.toHaveBeenCalled();
  });

  it('skips a chunk the voice fails on instead of ending the reading', () => {
    playSpeech('note:1', 'Uno. Due.');
    speech.spoken[0].onerror?.();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Uno.', 'Due.']);
  });

  it('un-pauses the queue before a new reading, so it is not silent in Chrome', () => {
    playSpeech('note:1', 'Uno.');
    pauseSpeech();
    playSpeech('note:2', 'Due.');
    expect(speech.paused).toBe(false);
    expect(getSpeechState()).toEqual({ status: 'speaking', sourceId: 'note:2' });
  });

  it('ignores pause, resume and stop with nothing playing', () => {
    pauseSpeech();
    resumeSpeech();
    stopSpeech();
    expect(speech.pause).not.toHaveBeenCalled();
    expect(speech.resume).not.toHaveBeenCalled();
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('resumes while the browser still has utterances queued', () => {
    playSpeech('document:1', 'Testo.');
    pauseSpeech();
    speech.speaking = false;
    speech.pending = true;
    resumeSpeech();
    expect(speech.resume).toHaveBeenCalled();
    expect(getSpeechState().status).toBe('speaking');
  });

  it('does nothing where the browser cannot speak', () => {
    uninstall();
    playSpeech('note:1', 'Ciao.');
    expect(getSpeechState().status).toBe('idle');
    ({ speech, uninstall } = installFakeSpeech());
  });

  it('has nothing to play for blank text', () => {
    playSpeech('note:1', '   ');
    expect(speech.spoken).toHaveLength(0);
    expect(getSpeechState().status).toBe('idle');
  });

  it('asks the browser for its voices ahead of the first reading', () => {
    const getVoices = vi.spyOn(speech, 'getVoices');
    primeSpeechVoices();
    expect(getVoices).toHaveBeenCalled();
  });
});

// Andrea's report (2026-10-10): the first reading of a session used the
// low-quality voice, the next ones the good one. Chrome lists no voices until
// it has loaded them, so the first reading must wait for them (spec 30b).
describe('the first reading of a page (spec 30b)', () => {
  const natural = {
    voiceURI: 'isabella',
    name: 'Microsoft Isabella Online (Natural) - Italian (Italy)',
    lang: 'it-IT',
    localService: false,
  };

  beforeEach(() => {
    uninstall();
    ({ speech, uninstall } = installFakeSpeech([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The reading starts on a resolved promise: let it settle.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('waits for the voice list, then reads with the best voice', async () => {
    playSpeech('note:1', 'Ciao.');
    expect(getSpeechState().status).toBe('speaking');
    expect(speech.spoken).toHaveLength(0);

    speech.loadVoices([{ voiceURI: 'elsa', name: 'Microsoft Elsa', lang: 'it-IT' }, natural]);
    await settle();

    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0].voice).toMatchObject({ voiceURI: 'isabella' });
    // Done waiting: a later list change starts nothing more.
    speech.loadVoices([natural]);
    await settle();
    expect(speech.spoken).toHaveLength(1);
  });

  it("falls back to the browser's default when the list never comes", async () => {
    vi.useFakeTimers();
    playSpeech('note:1', 'Ciao.');
    await vi.advanceTimersByTimeAsync(VOICES_WAIT_MS);

    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]).toMatchObject({ lang: 'it-IT', voice: null });
  });

  it('starts nothing when stopped or replaced while waiting', async () => {
    playSpeech('note:1', 'Uno.');
    stopSpeech();
    playSpeech('note:2', 'Due.');
    speech.loadVoices([natural]);
    await settle();

    expect(speech.spoken.map((u) => u.text)).toEqual(['Due.']);
  });

  it('keeps the reading when paused and resumed while waiting', async () => {
    playSpeech('note:1', 'Ciao.');
    pauseSpeech();
    resumeSpeech();
    expect(getSpeechState()).toEqual({ status: 'speaking', sourceId: 'note:1' });

    speech.loadVoices([natural]);
    await settle();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Ciao.']);
  });
});
