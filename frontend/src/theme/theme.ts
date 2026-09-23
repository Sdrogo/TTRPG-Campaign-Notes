import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Anchored at --accent-primary (#9333ea) = shade 6, --accent-strong (#a855f7) = shade 5.
const accent: MantineColorsTuple = [
  '#f2e7fc',
  '#e2c9f9',
  '#d2abf6',
  '#c38df3',
  '#b36ff0',
  '#a855f7',
  '#9333ea',
  '#782abf',
  '#5d2094',
  '#421769',
];

/**
 * The Mantine theme: the purple accent scale, the app's fonts and the radius
 * scale from context/ui-context.md. Dark only.
 */
export const theme = createTheme({
  primaryColor: 'accent',
  primaryShade: 6,
  colors: { accent },
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: { fontFamily: 'var(--font-display)' },
  defaultRadius: 'md',
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
  },
  black: '#0d0a0f',
  white: '#e8e3ea',
});
