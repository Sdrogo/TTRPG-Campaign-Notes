import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANCHOR_FLASH_CLASS, revealAnchor } from '../../lib/anchors';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('revealAnchor', () => {
  it('scrolls to the element and lights it up until its animation ends', () => {
    const element = document.createElement('div');
    element.id = 'note-1';
    document.body.append(element);
    const scroll = vi.spyOn(element, 'scrollIntoView');

    revealAnchor('note-1');

    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(element).toHaveClass(ANCHOR_FLASH_CLASS);
    element.dispatchEvent(new Event('animationend'));
    expect(element).not.toHaveClass(ANCHOR_FLASH_CLASS);
  });

  it('does nothing when the element is not on the page', () => {
    expect(() => revealAnchor('missing')).not.toThrow();
  });
});
