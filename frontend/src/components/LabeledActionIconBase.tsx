import { forwardRef } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import type { ActionIconProps } from '@mantine/core';

export interface LabeledActionIconProps extends ActionIconProps {
  /** What the button does: its accessible name and the tooltip shown on hover or long-press. */
  'aria-label'?: string;
}

// Kept apart from `LabeledActionIcon.tsx`, whose only export is the polymorphic wrapper,
// so each file exports components only and Fast Refresh keeps working.
export const LabeledActionIconBase = forwardRef<HTMLButtonElement, LabeledActionIconProps>(
  ({ 'aria-label': label, ...others }, ref) => (
    <Tooltip label={label} disabled={!label} withArrow>
      <ActionIcon ref={ref} aria-label={label} {...others} />
    </Tooltip>
  ),
);
LabeledActionIconBase.displayName = 'LabeledActionIcon';
