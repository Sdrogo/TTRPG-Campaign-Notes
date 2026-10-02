import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { EmojiPicker } from '../../../components/comments/EmojiPicker';
import { loadEmojiPicker } from '../../../lib/emojiPicker';

vi.mock('../../../lib/emojiPicker', () => ({ loadEmojiPicker: vi.fn() }));

const loadMock = vi.mocked(loadEmojiPicker);

// Stands in for emoji-mart's custom element: one button per emoji.
function fakePicker(options: Record<string, unknown>) {
  const element = document.createElement('div');
  const button = document.createElement('button');
  button.textContent = `pick (${String(options.locale)})`;
  const onSelect = options.onEmojiSelect as (emoji: { native: string }) => void;
  button.addEventListener('click', () => onSelect({ native: '🎲' }));
  element.append(button);
  return element;
}

beforeEach(() => {
  loadMock.mockReset();
});

describe('EmojiPicker', () => {
  it('shows a loader, then the picker in the UI language, and reports the pick', async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadEmojiPicker>>) => void = () => {};
    loadMock.mockReturnValue(new Promise((done) => (resolve = done)));
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<EmojiPicker onSelect={onSelect} />);
    expect(screen.getByLabelText('Caricamento delle emoji')).toBeInTheDocument();
    resolve({ Picker: fakePicker as never, data: {}, i18n: {} });

    await user.click(await screen.findByRole('button', { name: 'pick (it)' }));
    expect(loadMock).toHaveBeenCalledWith('it');
    expect(onSelect).toHaveBeenCalledWith('🎲');
    expect(screen.queryByLabelText('Caricamento delle emoji')).not.toBeInTheDocument();
  });

  it('says so when the picker cannot be loaded', async () => {
    loadMock.mockRejectedValue(new Error('offline'));

    renderWithProviders(<EmojiPicker onSelect={vi.fn()} />);

    expect(await screen.findByText(/Impossibile caricare le emoji/)).toBeInTheDocument();
  });

  it('builds nothing once it has been closed', async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadEmojiPicker>>) => void = () => {};
    let reject: (error: Error) => void = () => {};
    loadMock
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
    const Picker = vi.fn(fakePicker);

    const first = renderWithProviders(<EmojiPicker onSelect={vi.fn()} />);
    first.unmount();
    resolve({ Picker: Picker as never, data: {}, i18n: {} });
    const second = renderWithProviders(<EmojiPicker onSelect={vi.fn()} />);
    second.unmount();
    reject(new Error('offline'));

    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 0));
    expect(Picker).not.toHaveBeenCalled();
  });
});
