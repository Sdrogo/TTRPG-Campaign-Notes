import { useEffect, useState } from 'react';
import { speechSupported } from '../lib/speech';

/**
 * The browser's speech voices (spec 30 Decision 4). Chrome loads them after
 * the page, so the list starts empty and fills on `voiceschanged`.
 */
export function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    speechSupported() ? window.speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}
