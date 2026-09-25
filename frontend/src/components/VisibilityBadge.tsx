import { Badge, type MantineSize } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';
import { useTranslation } from 'react-i18next';

interface VisibilityBadgeProps {
  visibility: DocumentVisibility;
  size?: MantineSize;
}

/**
 * The visibility level of a Document or Comment, as a small badge. "Master
 * only" stands out in the accent color.
 */
export function VisibilityBadge({ visibility, size }: VisibilityBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge
      color={visibility === 'master' ? 'accent' : 'gray'}
      variant="light"
      size={size}
      // Never squeezed by a long title sitting next to it.
      style={{ flexShrink: 0 }}
    >
      {t(`visibility.level.${visibility}`)}
    </Badge>
  );
}
