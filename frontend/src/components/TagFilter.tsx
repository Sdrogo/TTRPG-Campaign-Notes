import { MultiSelect, Pill, type MultiSelectProps } from '@mantine/core';
import { FunnelIcon } from '@phosphor-icons/react';
import type { Tag } from '../types/tag';
import { useTranslation } from 'react-i18next';

interface TagFilterProps extends Omit<MultiSelectProps, 'data' | 'value' | 'onChange'> {
  tags: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
}

/** How many selected Tags show as pills before the rest collapse into "+N". */
export const MAX_DISPLAYED_TAGS = 2;

/**
 * Pick one or more Tags to filter a list by (FR-N2). Tags are shown as `#Name`,
 * like everywhere else. Always a single line (spec 11.1): only
 * `MAX_DISPLAYED_TAGS` pills show, the rest collapse into a "+N" pill, and the
 * pill row never wraps, so the control keeps its height however many Tags are
 * selected.
 */
export function TagFilter({ tags, value, onChange, ...props }: TagFilterProps) {
  const { t } = useTranslation();
  return (
    <MultiSelect
      aria-label={t('documents.filterByTag')}
      placeholder={value.length === 0 ? t('documents.filterByTag') : undefined}
      leftSection={<FunnelIcon size={16} />}
      data={tags.map((tag) => ({ value: tag.id, label: `#${tag.name}` }))}
      value={value}
      onChange={onChange}
      searchable
      clearable
      renderPill={({ option, value: tagId, onRemove, disabled }) => {
        // Mantine types the id as optional, but always passes the selected one.
        const index = value.indexOf(tagId as string);
        if (index > MAX_DISPLAYED_TAGS) return null;
        if (index === MAX_DISPLAYED_TAGS) {
          return <Pill>+{value.length - MAX_DISPLAYED_TAGS}</Pill>;
        }
        return (
          <Pill withRemoveButton onRemove={onRemove} disabled={disabled}>
            {option?.label}
          </Pill>
        );
      }}
      styles={{ pillsList: { flexWrap: 'nowrap', overflow: 'hidden' } }}
      {...props}
    />
  );
}
