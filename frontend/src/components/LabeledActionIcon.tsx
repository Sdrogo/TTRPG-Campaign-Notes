import { forwardRef } from 'react';
import { ActionIcon, createPolymorphicComponent, Tooltip } from '@mantine/core';
import type { ActionIconProps } from '@mantine/core';

interface LabeledActionIconProps extends ActionIconProps {
  /** What the button does: its accessible name and the tooltip shown on hover or long-press. */
  'aria-label'?: string;
}

const LabeledActionIconBase = forwardRef<HTMLButtonElement, LabeledActionIconProps>(
  ({ 'aria-label': label, ...others }, ref) => (
    <Tooltip label={label} disabled={!label} withArrow>
      <ActionIcon ref={ref} aria-label={label} {...others} />
    </Tooltip>
  ),
);
LabeledActionIconBase.displayName = 'LabeledActionIcon';

/**
 * An icon-only button that shows its `aria-label` as a tooltip after a moment over it
 * (or a long-press on touch screens), so every icon says what it does. Use it instead of
 * a bare `ActionIcon`; a button already wrapped in a `Tooltip` keeps its own.
 */
export const LabeledActionIcon = createPolymorphicComponent<'button', LabeledActionIconProps>(
  LabeledActionIconBase,
);
