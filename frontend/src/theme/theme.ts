import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Anchored at --accent-primary (#ea3333) = shade 6, --accent-strong (#f75555) = shade 5.
const accent: MantineColorsTuple = [
  'rgb(252, 231, 231)',
  'rgb(249, 201, 201)',
  'rgb(246, 171, 171)',
  'rgb(243, 141, 141)',
  'rgb(240, 111, 111)',
  'rgb(247, 85, 85)',
  'rgb(234, 51, 51)',
  'rgb(191, 42, 42)',
  'rgb(148, 32, 32)',
  'rgb(105, 23, 23)',
];

/**
 * The Mantine theme: the red accent scale, the app's fonts, the text scale and the
 * radius scale from context/ui-context.md. Dark only.
 *
 * Spec 49: text is two pixels larger per step than Mantine's default (`sm` 16px for
 * body text, `xs` 14px for small text); h1-h3 keep Mantine's sizes, h4-h6 follow the
 * body so a small heading is never smaller than the text under it.
 */
export const theme = createTheme({
  primaryColor: 'accent',
  primaryShade: 6,
  colors: { accent },
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  fontSizes: {
    xs: '0.875rem',
    sm: '1rem',
    md: '1.125rem',
    lg: '1.25rem',
    xl: '1.375rem',
  },
  headings: {
    fontFamily: 'var(--font-display)',
    sizes: {
      h4: { fontSize: '1.25rem' },
      h5: { fontSize: '1.125rem' },
      h6: { fontSize: '1rem' },
    },
  },
  defaultRadius: 'md',
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
  },
  black: '#0d0a0f',
  white: '#e8e3ea',
});
