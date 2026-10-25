import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoMode } from '../../lib/demo/demoMode';
import { renderWithProviders } from '../utils';
import { DemoPage } from '../../pages/DemoPage';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('DemoPage', () => {
  it('turns the Demo on and opens the sample Room with a full page load', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace });

    renderWithProviders(<DemoPage />, { route: '/demo' });

    expect(isDemoMode()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/rooms/demo/documents');
    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('says so when the browser blocks site storage', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    renderWithProviders(<DemoPage />, { route: '/demo' });

    expect(screen.getByText('La demo ha bisogno dei dati del sito, che questo browser blocca.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
    expect(replace).not.toHaveBeenCalled();
  });
});
