import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { notifyError } from '../../../lib/notify';
import { applyPalette, currentPalette, readStoredPalette } from '../../../lib/palette';
import { renderWithProviders } from '../../utils';
import { ColorPaletteSection } from '../../../components/account/ColorPaletteSection';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const account = (palette: string | null) => ({
  user_id: 'me',
  email: 'me@example.com',
  display_name: null,
  pronouns: null,
  bio: null,
  avatar_url: null,
  color_palette: palette,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(notifyError).mockClear();
});

afterEach(() => {
  applyPalette('standard');
  localStorage.clear();
});

describe('ColorPaletteSection (spec 78)', () => {
  it('offers the four palettes with the current one checked', () => {
    renderWithProviders(<ColorPaletteSection value="tritan" />);

    expect(screen.getByText('Colori delle mappe')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Tritanopia \(blu\)/ })).toBeChecked();
  });

  it('draws the picked palette at once and saves it on the account', async () => {
    fetchMock.mockResolvedValue(account('deutan'));
    const user = userEvent.setup();
    renderWithProviders(<ColorPaletteSection value="standard" />);

    await user.click(screen.getByRole('radio', { name: /Deuteranopia \(verde\)/ }));

    expect(currentPalette()).toBe('deutan');
    expect(document.documentElement.dataset.palette).toBe('deutan');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/account', {
        method: 'PATCH',
        json: { color_palette: 'deutan' },
      }),
    );
    expect(readStoredPalette()).toBe('deutan');
  });

  it('sends null for the standard palette', async () => {
    applyPalette('protan');
    fetchMock.mockResolvedValue(account(null));
    const user = userEvent.setup();
    renderWithProviders(<ColorPaletteSection value="protan" />);

    await user.click(screen.getByRole('radio', { name: /Standard/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/account', {
        method: 'PATCH',
        json: { color_palette: null },
      }),
    );
    expect(currentPalette()).toBe('standard');
  });

  it('keeps a later pick when an earlier save fails', async () => {
    let failFirst: (error: Error) => void = () => {};
    fetchMock
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (failFirst = reject)))
      .mockResolvedValueOnce(account('tritan'));
    const user = userEvent.setup();
    renderWithProviders(<ColorPaletteSection value="standard" />);

    await user.click(screen.getByRole('radio', { name: /Protanopia \(rosso\)/ }));
    expect(screen.getByRole('radio', { name: /Protanopia \(rosso\)/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Tritanopia \(blu\)/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    failFirst(new Error('offline'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentPalette()).toBe('tritan');
  });

  it('puts the previous palette back when the save fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithProviders(<ColorPaletteSection value="standard" />);

    await user.click(screen.getByRole('radio', { name: /Protanopia \(rosso\)/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(currentPalette()).toBe('standard');
  });
});
