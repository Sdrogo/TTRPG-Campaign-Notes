import { useState } from 'react';
import { Button, Group, MultiSelect } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { sortTagsByName } from '../../lib/tags';
import type { Tag } from '../../types/tag';

interface CombinationAdderProps {
  /** Every Tag of the Room: any of them can be part of a combination. */
  tags: Tag[];
  /** Whether this set of Tags is already a Main item (order doesn't matter). */
  isListed: (tagIds: string[]) => boolean;
  /** Adds the picked Tags as one combination, in the order they were picked. */
  onAdd: (tagIds: string[]) => void;
}

/**
 * Picks two or more Tags and adds them as one combination (spec 11_2) - the
 * Documents carrying all of them form a group on the Documents page. Add stays
 * disabled for fewer than two Tags and for a set that's already listed, which
 * the backend would reject anyway.
 */
export function CombinationAdder({ tags, isListed, onAdd }: CombinationAdderProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);

  const canAdd = picked.length >= 2 && !isListed(picked);

  /** Hands the picked Tags over and clears the field for the next one. */
  const handleAdd = () => {
    onAdd(picked);
    setPicked([]);
  };

  return (
    <Group align="flex-end" wrap="wrap">
      <MultiSelect
        label={t('setup.mainTags.combinationLabel')}
        placeholder={picked.length === 0 ? t('setup.mainTags.combinationPlaceholder') : undefined}
        data={sortTagsByName(tags).map((tag) => ({ value: tag.id, label: tag.name }))}
        value={picked}
        onChange={setPicked}
        searchable
        style={{ flex: '1 1 240px', maxWidth: 420 }}
      />
      <Button variant="light" onClick={handleAdd} disabled={!canAdd}>
        {t('setup.mainTags.addCombination')}
      </Button>
    </Group>
  );
}
