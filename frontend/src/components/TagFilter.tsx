import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { FunnelIcon } from '@phosphor-icons/react';
import type { Tag } from '../types/tag';

interface TagFilterProps extends Omit<MultiSelectProps, 'data' | 'value' | 'onChange'> {
  tags: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
}

// Pick one or more Tags to filter a list by (FR-N2). Tags are shown as
// `#Name`, like everywhere else.
export function TagFilter({ tags, value, onChange, ...props }: TagFilterProps) {
  return (
    <MultiSelect
      aria-label="Filtra per Tag"
      placeholder={value.length === 0 ? 'Filtra per Tag' : undefined}
      leftSection={<FunnelIcon size={16} />}
      data={tags.map((tag) => ({ value: tag.id, label: `#${tag.name}` }))}
      value={value}
      onChange={onChange}
      searchable
      clearable
      {...props}
    />
  );
}
