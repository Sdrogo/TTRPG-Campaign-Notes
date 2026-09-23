import { Select, type SelectProps } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';

// What the level means depends on what it's set on: a Document's "owner"
// is its Owner list, a Comment's is its author (VR-03).
const OPTIONS: Record<'document' | 'comment', { value: DocumentVisibility; label: string }[]> = {
  document: [
    { value: 'room', label: 'Stanza (tutti i membri)' },
    { value: 'master', label: 'Solo Master' },
    { value: 'private', label: 'Privato (Owner + Master)' },
    { value: 'selective', label: 'Selettivo (solo Owner + Master finché non scegli altri)' },
  ],
  comment: [
    { value: 'room', label: 'Stanza (tutti i membri)' },
    { value: 'master', label: 'Solo Master (e te)' },
    { value: 'private', label: 'Privato (tu + Master)' },
    { value: 'selective', label: 'Selettivo (tu, Master e chi scegli)' },
  ],
};

interface VisibilitySelectProps extends Omit<SelectProps, 'data' | 'value' | 'onChange'> {
  subject: 'document' | 'comment';
  value: DocumentVisibility;
  onChange: (value: DocumentVisibility) => void;
}

/**
 * Picks a visibility level. The labels depend on `subject`: a Document's level
 * is described in terms of its Owners, a Comment's in terms of its author.
 */
export function VisibilitySelect({ subject, value, onChange, ...props }: VisibilitySelectProps) {
  return (
    <Select
      {...props}
      data={OPTIONS[subject]}
      value={value}
      onChange={(next) => onChange((next as DocumentVisibility | null) ?? 'room')}
      allowDeselect={false}
    />
  );
}
