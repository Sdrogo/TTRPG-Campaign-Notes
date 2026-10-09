import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../utils';
import { ReadAloudControls } from '../../../components/speech/ReadAloudControls';
import { playSpeech, stopSpeech } from '../../../lib/speechPlayer';
import { installFakeSpeech } from '../../speech';

let uninstall: (() => void) | undefined;

afterEach(() => {
  stopSpeech();
  uninstall?.();
  uninstall = undefined;
});

function render() {
  renderWithProviders(
    <ReadAloudControls sourceId="document:1" name="La Torre" getText={() => 'Una torre. Alta.'} />,
  );
  return userEvent.setup();
}

describe('ReadAloudControls (spec 30)', () => {
  it('renders nothing where the browser cannot speak (Decision 1)', () => {
    render();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('plays, pauses, resumes and stops', async () => {
    const fake = installFakeSpeech();
    uninstall = fake.uninstall;
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Ascolta «La Torre»' }));
    expect(fake.speech.spoken.map((u) => u.text)).toEqual(['Una torre.']);

    await user.click(screen.getByRole('button', { name: 'Metti in pausa la lettura' }));
    expect(fake.speech.pause).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Riprendi la lettura' }));
    expect(fake.speech.resume).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Interrompi la lettura' }));
    expect(screen.getByRole('button', { name: 'Ascolta «La Torre»' })).toBeInTheDocument();
  });

  it('returns to the speaker when the reading ends', async () => {
    const fake = installFakeSpeech();
    uninstall = fake.uninstall;
    const user = render();

    await user.click(screen.getByRole('button', { name: 'Ascolta «La Torre»' }));
    act(() => fake.speech.finishCurrent());
    act(() => fake.speech.finishCurrent());

    expect(screen.getByRole('button', { name: 'Ascolta «La Torre»' })).toBeInTheDocument();
  });

  it('stays a speaker while something else is being read (one reading at a time)', () => {
    const fake = installFakeSpeech();
    uninstall = fake.uninstall;
    render();

    act(() => playSpeech('note:9', 'Altro.'));

    expect(screen.getByRole('button', { name: 'Ascolta «La Torre»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Interrompi la lettura' })).not.toBeInTheDocument();
  });
});
