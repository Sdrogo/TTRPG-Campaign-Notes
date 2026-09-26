import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Anchored at --accent-primary (#9333ea) = shade 6, --accent-strong (#a855f7) = shade 5.
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
