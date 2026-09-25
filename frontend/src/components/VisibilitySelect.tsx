import { Select, type SelectProps } from '@mantine/core';
import type { DocumentVisibility } from '../types/document';
import { useTranslation } from 'react-i18next';

const LEVELS: DocumentVisibility[] = ['room', 'master', 'private', 'selective'];

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
  const { t } = useTranslation();
  // What the level means depends on what it's set on: a Document's "owner"
  // is its Owner list, a Comment's is its author (VR-03).
  const data = LEVELS.map((level) => ({
    value: level,
    label:
      subject === 'document'
        ? t(`visibility.documentOption.${level}`)
        : t(`visibility.commentOption.${level}`),
  }));

  return (
    <Select
      {...props}
      data={data}
      value={value}
      onChange={(next) => onChange((next as DocumentVisibility | null) ?? 'room')}
      allowDeselect={false}
    />
  );
}
