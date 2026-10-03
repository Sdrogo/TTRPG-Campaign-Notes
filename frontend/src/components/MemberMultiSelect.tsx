import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { memberOptionLabel } from '../lib/members';
import type { Member } from '../types/member';

interface MemberMultiSelectProps extends Omit<MultiSelectProps, 'data' | 'value' | 'onChange'> {
  members: Member[];
  value: string[];
  onChange: (userIds: string[]) => void;
  /** Members who can't be picked (e.g. the author, who always sees their own content). */
  excludeUserIds?: string[];
}

/**
 * Picks Room members, e.g. for a Selective visibility grant list. Options tell
 * apart members with the same name (`memberOptionLabel`), since picking the
 * wrong person grants them access.
 */
export function MemberMultiSelect({
  members,
  value,
  onChange,
  excludeUserIds = [],
  ...props
}: MemberMultiSelectProps) {
  const data = members
    .filter((m) => !excludeUserIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: memberOptionLabel(m, members) }));

  return <MultiSelect {...props} data={data} value={value} onChange={onChange} searchable />;
}
