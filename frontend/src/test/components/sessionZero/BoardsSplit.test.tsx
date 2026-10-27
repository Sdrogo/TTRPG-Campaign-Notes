import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardsSplit, DEFAULT_SIDE_PERCENT, MAX_SIDE_PERCENT } from '../../../components/sessionZero/BoardsSplit';
import { renderWithProviders } from '../../utils';

const KEY = 'sessionZero:linesVeilsWidth';

/** The page is 1000px wide, from x 0 to 1000. */
function render(width = 1000) {
  renderWithProviders(<BoardsSplit left={<p>Retro</p>} right={<p>Linee</p>} />);
  const handle = screen.getByRole('separator', { name: 'Ridimensiona Linee e Veli' });
  const frame = handle.parentElement!;
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ width, right: width } as DOMRect);
  return { handle, side: () => handle.nextElementSibling as HTMLElement };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

// Spec 46c Decision 10.
describe('BoardsSplit', () => {
  it('starts Lines & Veils at a third', () => {
    const { handle, side } = render();
    expect(handle).toHaveAttribute('aria-valuenow', '33');
    expect(side().style.flex).toBe(`0 0 ${DEFAULT_SIDE_PERCENT}%`);
    expect(screen.getByText('Retro')).toBeInTheDocument();
    expect(screen.getByText('Linee')).toBeInTheDocument();
  });

  it('follows a drag, between 280px and 60%, and remembers it', () => {
    const { handle } = render();
    fireEvent.pointerMove(handle, { clientX: 500 });
    expect(handle).toHaveAttribute('aria-valuenow', '33');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 667 });
    expect(handle).toHaveAttribute('data-dragging');
    fireEvent.pointerMove(handle, { clientX: 500 });
    expect(handle).toHaveAttribute('aria-valuenow', '50');
    expect(localStorage.getItem(KEY)).toBe('50');
    fireEvent.pointerMove(handle, { clientX: 100 });
    expect(handle).toHaveAttribute('aria-valuenow', String(MAX_SIDE_PERCENT));
    fireEvent.pointerMove(handle, { clientX: 950 });
    expect(handle).toHaveAttribute('aria-valuenow', '28');
    fireEvent.pointerUp(handle);
    expect(handle).not.toHaveAttribute('data-dragging');
    fireEvent.pointerMove(handle, { clientX: 500 });
    expect(handle).toHaveAttribute('aria-valuenow', '28');

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerCancel(handle);
    expect(handle).not.toHaveAttribute('data-dragging');
  });

  it('ignores a drag while the page has no width', () => {
    const { handle } = render(0);
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 500 });
    expect(handle).toHaveAttribute('aria-valuenow', '33');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '0');
  });

  it('moves with the keyboard and goes back to a third on a double click', () => {
    const { handle } = render();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '35');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '31');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '60');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '28');
    fireEvent.keyDown(handle, { key: 'a' });
    expect(handle).toHaveAttribute('aria-valuenow', '28');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '33');
  });

  it('never lets the narrowest share go past the widest on a small page', () => {
    const { handle } = render(400);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '60');
  });

  it('starts from the width remembered in this browser, if it is valid', () => {
    localStorage.setItem(KEY, '45');
    expect(render().handle).toHaveAttribute('aria-valuenow', '45');
  });

  it('ignores a remembered width out of bounds', () => {
    localStorage.setItem(KEY, '90');
    expect(render().handle).toHaveAttribute('aria-valuenow', '33');
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { handle } = render();
    expect(handle).toHaveAttribute('aria-valuenow', '33');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '35');
  });
});
