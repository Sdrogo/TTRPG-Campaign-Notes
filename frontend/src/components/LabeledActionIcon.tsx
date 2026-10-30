import { createPolymorphicComponent } from '@mantine/core';
import { LabeledActionIconBase } from './LabeledActionIconBase';
import type { LabeledActionIconProps } from './LabeledActionIconBase';

/**
 * An icon-only button that shows its `aria-label` as a tooltip after a moment over it
 * (or a long-press on touch screens), so every icon says what it does. Use it instead of
 * a bare `ActionIcon`; a button already wrapped in a `Tooltip` keeps its own.
 */
export const LabeledActionIcon = createPolymorphicComponent<'button', LabeledActionIconProps>(
  LabeledActionIconBase,
);
