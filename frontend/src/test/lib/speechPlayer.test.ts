import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSpeechState,
  pauseSpeech,
  playSpeech,
  resumeSpeech,
  stopSpeech,
  subscribeSpeech,
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
});
