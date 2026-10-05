import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/apiClient';
import { renderWithProviders } from '../../utils';
import { SearchButton } from '../../../components/search/SearchButton';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const dialog = () => screen.queryByRole('dialog', { name: 'Cerca nella Stanza' });

function render() {
  renderWithProviders(
    <>
      <SearchButton roomId="room-1" />
      <input aria-label="Altro campo" />
    </>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue([]);
});

// Spec 21 Decision 2: opened by click, `/` or Ctrl+K on every Room page.
describe('SearchButton', () => {
  it('opens the search from the field on wide screens and the icon on phones', async () => {
    const user = render();

    // Both are in the page; CSS shows one per screen size.
    const [field, icon] = screen.getAllByRole('button', { name: /Cerca/ });
    expect(field).toHaveTextContent('Ctrl K');
    await user.click(icon);
    expect(dialog()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(field);
    expect(dialog()).toBeInTheDocument();
  });

  it('opens with Ctrl+K, even from a text field', () => {
    render();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Altro campo' }), {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
    });

    expect(dialog()).toBeInTheDocument();
  });

  it('opens with /, except while typing in a text field', () => {
    render();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Altro campo' }), {
      key: '/',
      code: 'Slash',
    });
    expect(dialog()).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' });
    expect(dialog()).toBeInTheDocument();
  });
});
