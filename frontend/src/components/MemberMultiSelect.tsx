import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { memberDisplayName } from '../lib/members';
import type { Member } from '../types/member';

interface MemberMultiSelectProps extends Omit<MultiSelectProps, 'data' | 'value' | 'onChange'> {
  members: Member[];
  value: string[];
  onChange: (userIds: string[]) => void;
  // Members who can't be picked (e.g. the author, who always sees their own content).
  excludeUserIds?: string[];
}

// Picks Room members by email, e.g. for a Selective visibility grant list.
export function MemberMultiSelect({
  members,
  value,
  onChange,
  excludeUserIds = [],
  ...props
}: MemberMultiSelectProps) {
  const data = members
    .filter((m) => !excludeUserIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: memberDisplayName(m) }));

  return <MultiSelect {...props} data={data} value={value} onChange={onChange} searchable />;
}
