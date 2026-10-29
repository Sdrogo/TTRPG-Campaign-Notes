import type { ReactNode } from 'react';
import { Badge, Tooltip, type MantineSize } from '@mantine/core';
import {
  CrownSimpleIcon,
  LockSimpleIcon,
  UserCheckIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import type { DocumentVisibility } from '../types/document';
import { useTranslation } from 'react-i18next';

interface VisibilityBadgeProps {
  visibility: DocumentVisibility;
  size?: MantineSize;
  /** Shown inside the badge before the label (e.g. the card's unread dot). */
  leftSection?: ReactNode;
  /**
   * Icon only, with the level as its label and tooltip: the phone's compact
   * Document header (Andrea, 2026-10-15).
   */
  compact?: boolean;
}

const LEVEL_ICONS = {
  room: UsersThreeIcon,
  master: CrownSimpleIcon,
  private: LockSimpleIcon,
  selective: UserCheckIcon,
} as const;

/**
 * The visibility level of a Document or Comment, as a small badge. "Master
 * only" stands out in the accent color.
 */
export function VisibilityBadge({ visibility, size, leftSection, compact }: VisibilityBadgeProps) {
  const { t } = useTranslation();
  const label = t(`visibility.level.${visibility}`);

  if (compact) {
    const LevelIcon = LEVEL_ICONS[visibility];
    return (
      <Tooltip label={label} withArrow>
        <Badge
          role="img"
          aria-label={label}
          color={visibility === 'master' ? 'accent' : 'gray'}
          variant="light"
          size={size}
          px={6}
          style={{ flexShrink: 0 }}
        >
          <LevelIcon size={16} style={{ display: 'block' }} />
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Badge
      color={visibility === 'master' ? 'accent' : 'gray'}
      variant="light"
      size={size}
      leftSection={leftSection}
      // Never squeezed by a long title sitting next to it.
      style={{ flexShrink: 0 }}
    >
      {label}
    </Badge>
  );
}
