import { Badge, type MantineSize } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';

const LABELS: Record<DocumentVisibility, string> = {
  room: 'Stanza',
  master: 'Solo Master',
  private: 'Privato',
  selective: 'Selettivo',
};

interface VisibilityBadgeProps {
  visibility: DocumentVisibility;
  size?: MantineSize;
}

export function VisibilityBadge({ visibility, size }: VisibilityBadgeProps) {
  return (
    <Badge
      color={visibility === 'master' ? 'accent' : 'gray'}
      variant="light"
      size={size}
      // Never squeezed by a long title sitting next to it.
      style={{ flexShrink: 0 }}
    >
      {LABELS[visibility]}
    </Badge>
  );
}
