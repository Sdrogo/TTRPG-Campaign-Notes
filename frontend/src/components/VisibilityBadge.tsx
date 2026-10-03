import type { ReactNode } from 'react';
import { Badge, type MantineSize } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';
import { useTranslation } from 'react-i18next';

interface VisibilityBadgeProps {
  visibility: DocumentVisibility;
  size?: MantineSize;
  /** Shown inside the badge before the label (e.g. the card's unread dot). */
  leftSection?: ReactNode;
}

/**
 * The visibility level of a Document or Comment, as a small badge. "Master
 * only" stands out in the accent color.
 */
export function VisibilityBadge({ visibility, size, leftSection }: VisibilityBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge
      color={visibility === 'master' ? 'accent' : 'gray'}
      variant="light"
      size={size}
      leftSection={leftSection}
      // Never squeezed by a long title sitting next to it.
      style={{ flexShrink: 0 }}
    >
      {t(`visibility.level.${visibility}`)}
    </Badge>
  );
}
