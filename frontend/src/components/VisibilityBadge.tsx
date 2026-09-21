import { Badge } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';

const LABELS: Record<DocumentVisibility, string> = {
  room: 'Stanza',
  master: 'Solo Master',
  private: 'Privato',
  selective: 'Selettivo',
};

interface VisibilityBadgeProps {
  visibility: DocumentVisibility;
}

export function VisibilityBadge({ visibility }: VisibilityBadgeProps) {
  return (
    <Badge color={visibility === 'master' ? 'accent' : 'gray'} variant="light">
      {LABELS[visibility]}
    </Badge>
  );
}
