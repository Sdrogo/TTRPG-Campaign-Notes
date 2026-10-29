/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom does no layout, so the stacking that keeps the Document page's aside
// clickable is asserted on the stylesheet itself, read from disk (a `?raw`
// import comes back empty, since the test config turns CSS off).
const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

/** The declarations of every `selector { ... }` block in `source`, joined. */
function declarations(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join(';');
}

describe('Document page aside', () => {
  it('stays above the floated-around Notes, so the mention map buttons get the clicks', () => {
    // Regression: `.note-item` is positioned, so its full-width box painted
    // over the floated aside and swallowed the mention map's zoom buttons.
    const desktop = css.slice(css.indexOf('@media (min-width: 75em)'));
    const aside = declarations(desktop, '.document-body-aside');
    expect(aside).toMatch(/float:\s*right/);
    expect(aside).toMatch(/position:\s*relative/);
    expect(aside).toMatch(/z-index:\s*1/);
  });
});

describe('Document page heading on a phone', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 48em) {\n  .document-detail-heading'));

  it('puts the actions on the kicker line instead of a row under the name', () => {
    expect(declarations(phone, '.document-detail-heading.mantine-Group-root')).toMatch(/display:\s*grid/);
    expect(declarations(phone, '.document-detail-titles')).toMatch(/display:\s*contents/);
    expect(declarations(phone, '.document-detail-heading .document-detail-meta')).toMatch(/grid-area:\s*1 \/ 2/);
    expect(css).not.toMatch(/flex-direction:\s*column;\s*align-items:\s*stretch;/);
  });
});

describe('Compact touch targets', () => {
  it('keep their desktop size on a touch screen and a 40px ring to tap', () => {
    const touch = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(declarations(touch, '.mantine-ActionIcon-root.compact-touch-target')).toMatch(/--ai-size-xs:\s*24px/);
    expect(declarations(touch, '.compact-touch-target::before')).toMatch(/inset:\s*-8px/);
  });
});
