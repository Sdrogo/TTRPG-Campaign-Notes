import { Box, Text } from '@mantine/core';

/** One bar: its value and the label read on hover and by screen readers. */
export interface Bar {
  label: string;
  value: number;
}

interface BarChartProps {
  /** The chart's name for screen readers. */
  title: string;
  bars: Bar[];
  /** The bar color, a CSS color or variable. */
  color?: string;
  height?: number;
}

/**
 * A plain SVG bar chart for the Admin page (ticket 75): one bar per item,
 * scaled to the largest, with the value and label in each bar's tooltip.
 * No axis beyond the largest value; the page's tables carry the exact numbers.
 */
export function BarChart({ title, bars, color = 'var(--mantine-primary-color-filled)', height = 120 }: BarChartProps) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const width = Math.max(bars.length, 1);
  return (
    <Box>
      <Text size="xs" c="dimmed" ta="right">
        {max}
      </Text>
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ display: 'block', borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        {bars.map((bar, index) => {
          const barHeight = (bar.value / max) * 100;
          return (
            <rect
              key={bar.label}
              x={index + 0.1}
              y={100 - barHeight}
              width={0.8}
              height={barHeight}
              fill={color}
            >
              <title>{`${bar.label}: ${bar.value}`}</title>
            </rect>
          );
        })}
      </svg>
    </Box>
  );
}
