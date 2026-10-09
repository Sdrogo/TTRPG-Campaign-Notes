import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../utils';
import { SpeechSection } from '../../../components/account/SpeechSection';
import { readSpeechPreferences, saveSpeechPreferences } from '../../../lib/speech';
import { stopSpeech } from '../../../lib/speechPlayer';
import { installFakeSpeech } from '../../speech';

let uninstall: (() => void) | undefined;

afterEach(() => {
  stopSpeech();
  uninstall?.();
  uninstall = undefined;
});

const voices = [
  { voiceURI: 'alice', name: 'Alice', lang: 'it-IT' },
  { voiceURI: 'daniel', name: 'Daniel', lang: 'en-GB' },
];

function render(withVoices = voices) {
  const fake = installFakeSpeech(withVoices);
  uninstall = fake.uninstall;
  renderWithProviders(<SpeechSection />);
  return { speech: fake.speech, user: userEvent.setup() };
}

describe('SpeechSection (spec 30 Decision 4)', () => {
  it('says so where the browser cannot speak', () => {
    renderWithProviders(<SpeechSection />);

    expect(screen.getByText('Questo browser non sa leggere ad alta voce.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prova' })).not.toBeInTheDocument();
  });

  it('starts on "Automatica" and stores the voice picked for the app language', async () => {
    const { user } = render();
    const select = screen.getByRole('combobox', { name: 'Voce' });
    expect(select).toHaveValue('Automatica');

    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Alice (it-IT)' }));

    expect(readSpeechPreferences().voices).toEqual({ it: 'alice' });
  });

  it('keeps the other language’s voice when going back to "Automatica"', async () => {
    saveSpeechPreferences({ voices: { it: 'alice', en: 'daniel' }, rate: 1 });
    const { user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Voce' }));
    await user.click(await screen.findByRole('option', { name: 'Automatica' }));

    expect(readSpeechPreferences().voices).toEqual({ en: 'daniel' });
  });

  it('stores the speed', async () => {
    const { user } = render();

    await user.click(screen.getByText('1,5×'));

    expect(readSpeechPreferences().rate).toBe(1.5);
  });

  it('notes when the device has no voice in the app language', () => {
    render([{ voiceURI: 'daniel', name: 'Daniel', lang: 'en-GB' }]);

    expect(screen.getByText(/Nessuna voce in italiano/)).toBeInTheDocument();
  });

  it('lists no "Altre voci" group when every voice speaks the app language', async () => {
    const { user } = render([voices[0]]);

    await user.click(screen.getByRole('combobox', { name: 'Voce' }));

    expect(await screen.findByRole('option', { name: 'Alice (it-IT)' })).toBeInTheDocument();
    expect(screen.queryByText('Altre voci')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nessuna voce in italiano/)).not.toBeInTheDocument();
  });

  it('plays a sample with "Prova", and stops it', async () => {
    const { speech, user } = render();

    await user.click(screen.getByRole('button', { name: 'Prova' }));
    expect(speech.spoken).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Interrompi la lettura' }));
    expect(screen.getByRole('button', { name: 'Prova' })).toBeInTheDocument();
  });
});
