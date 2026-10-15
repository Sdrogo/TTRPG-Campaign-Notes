import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { SplitView } from '../../../components/layout/SplitView';
import { SPLIT_STORAGE_KEY } from '../../../lib/splitView';

describe('SplitView (spec 37 Decision 3)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('starts at half and moves with the arrow keys, remembering the width', () => {
    renderWithProviders(<SplitView left={<p>Mappa</p>} right={<p>Thorn</p>} />);
    const divider = screen.getByRole('separator', { name: 'Ridimensiona i pannelli' });
    expect(divider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '45');
    fireEvent.keyDown(divider, { key: 'Enter' });
    expect(divider).toHaveAttribute('aria-valuenow', '45');
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe('0.45');
    expect(screen.getByText('Mappa')).toBeInTheDocument();
    expect(screen.getByText('Thorn')).toBeInTheDocument();
  });

  it('fits a width remembered on a wider screen, without forgetting it', () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, '0.9');
    renderWithProviders(<SplitView left={<p>Mappa</p>} right={<p>Thorn</p>} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '68');
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe('0.9');
  });

  it('follows the pointer while dragged, within the panes minimum width', () => {
    // jsdom has no PointerEvent, so the coordinates would be dropped.
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    vi.stubGlobal('PointerEvent', FakePointerEvent);
    let captured = false;
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {
      captured = true;
    });
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockImplementation(() => captured);
    renderWithProviders(<SplitView left={<p>Mappa</p>} right={<p>Thorn</p>} />);
    const divider = screen.getByRole('separator');

    // Moving without having grabbed it does nothing.
    fireEvent.pointerMove(divider, { clientX: 700, pointerId: 1 });
    expect(divider).toHaveAttribute('aria-valuenow', '50');

    fireEvent.pointerDown(divider, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 600, pointerId: 1 });
    expect(divider).toHaveAttribute('aria-valuenow', '60');
    fireEvent.pointerMove(divider, { clientX: 950, pointerId: 1 });
    expect(divider).toHaveAttribute('aria-valuenow', '68');
  });
});
