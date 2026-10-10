import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderHookWithProviders } from '../utils';
import { useSpeechVoices } from '../../hooks/useSpeechVoices';
import { installFakeSpeech } from '../speech';

describe('useSpeechVoices (spec 30)', () => {
  it('is empty where the browser cannot speak', () => {
    const { result } = renderHookWithProviders(() => useSpeechVoices());

    expect(result.current).toEqual([]);
  });

  it('picks up the voices Chrome loads late, and stops listening on unmount', () => {
    const { speech, uninstall } = installFakeSpeech([]);
    const { result, unmount } = renderHookWithProviders(() => useSpeechVoices());
    expect(result.current).toEqual([]);

    const [event, listener] = speech.addEventListener.mock.calls[0] as [string, () => void];
    expect(event).toBe('voiceschanged');
    speech.voices = [{ voiceURI: 'alice', name: 'Alice', lang: 'it-IT' }];
    act(() => listener());
    expect(result.current).toEqual([{ voiceURI: 'alice', name: 'Alice', lang: 'it-IT' }]);

    unmount();
    expect(speech.removeEventListener).toHaveBeenCalledWith('voiceschanged', listener);
    uninstall();
  });
});
