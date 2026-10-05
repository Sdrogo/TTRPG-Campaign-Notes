/** The class that briefly lights up what an anchor led to (`index.css`). */
export const ANCHOR_FLASH_CLASS = 'anchor-flash';

/**
 * Scrolls the element with this id into view and lights it up for a moment,
 * so the Note or Comment a link led to (a search result, spec 21; a
 * "Mentioned in" entry, spec 20) stands out. Nothing happens when it isn't on
 * the page.
 */
export function revealAnchor(elementId: string): void {
  const element = window.document.getElementById(elementId);
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.add(ANCHOR_FLASH_CLASS);
  element.addEventListener('animationend', () => element.classList.remove(ANCHOR_FLASH_CLASS), {
    once: true,
  });
}
