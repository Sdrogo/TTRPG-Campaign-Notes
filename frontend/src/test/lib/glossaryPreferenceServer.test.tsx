import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useGlossaryHighlight } from '../../lib/glossaryPreference';

function Probe() {
  return <span>{useGlossaryHighlight() ? 'on' : 'off'}</span>;
}

describe('the Glossary highlight switch before the browser is there', () => {
  it('renders as on on the server', () => {
    expect(renderToString(<Probe />)).toContain('on');
  });
});
