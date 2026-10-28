import { describe, expect, it } from 'vitest';
import { theme } from '../../theme/theme';

describe('theme (spec 49)', () => {
  it('keeps body text at 16px and small text at 14px', () => {
    expect(theme.fontSizes).toMatchObject({ xs: '0.875rem', sm: '1rem', md: '1.125rem' });
  });

  it('keeps h1-h3 at Mantine sizes and h5 no smaller than body text', () => {
    expect(theme.headings?.sizes?.h1).toBeUndefined();
    expect(theme.headings?.sizes?.h2).toBeUndefined();
    expect(theme.headings?.sizes?.h3).toBeUndefined();
    expect(theme.headings?.sizes?.h5?.fontSize).toBe('1.125rem');
  });
});
